"""UT Stems server for other PCs: they send links or files, this PC separates them.

    python -m ut_stems.remote              start the server (ut_stems_server.bat)
    python -m ut_stems.remote --list       registered PCs
    python -m ut_stems.remote --revoke X   remove a registered PC (name or id)

How it fits together:

- HTTPS on TCP port 47900 with a self-signed certificate made on the first start. A client
  pins the certificate the first time it connects, so later connections cannot be redirected.
- A new PC asks to register; a window on this PC asks whether to allow it. Once allowed, the
  PC gets a key of its own and is let in without asking again. ``--revoke`` takes it back.
- On the same network, clients find the server by a UDP broadcast on port 47900. From
  elsewhere, the server's address is typed once on the client and remembered.
- Every PC sees only its own songs. It adds links, or uploads files; it cannot name files on
  this PC. Its stems are written to a folder of its own here and downloaded by the client.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import secrets
import shutil
import socket
import ssl
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import __version__
from .server import DENIED, Handler, Workspace
from http.server import ThreadingHTTPServer

PORT = 47900
DISCOVER = b"UT-STEMS-DISCOVER 1"
MAX_CONNECTIONS = 64
REQUEST_LIFETIME = 300  # seconds a registration request stays valid
APPROVAL_TIMEOUT = 120  # seconds the approval window waits before it counts as "no"


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "UT Stems Server"


def confirmation_code(request: str, fingerprint: str) -> str:
    """Four digits shown on both PCs while a registration waits. They only match when the
    client talks to this server directly (the code depends on the certificate it sees)."""
    digest = hashlib.sha256(f"{request}:{fingerprint}".encode()).digest()
    return f"{int.from_bytes(digest[:4], 'big') % 10000:04d}"


# ---------------------------------------------------------------- certificate
def ensure_certificate(folder: Path) -> tuple[Path, Path, str]:
    """The server's certificate and key, made once. Returns their paths and the SHA-256
    fingerprint of the certificate (hex), which clients pin."""
    cert, key = folder / "server.crt", folder / "server.key"
    if not (cert.is_file() and key.is_file()):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.x509.oid import NameOID
        folder.mkdir(parents=True, exist_ok=True)
        private = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"UT Stems Server {socket.gethostname()}"[:64])])
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                       .public_key(private.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=365 * 30))
                       .sign(private, hashes.SHA256()))
        key.write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                              serialization.NoEncryption()))
        cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    der = ssl.PEM_cert_to_DER_cert(cert.read_text())
    return cert, key, hashlib.sha256(der).hexdigest()


# ---------------------------------------------------------------- registered PCs
class Devices:
    """Registered PCs, kept in ``devices.json``. Only a hash of each key is stored."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self._load()

    def _stamp(self):
        try:
            return self.path.stat().st_mtime_ns
        except OSError:
            return None

    def _load(self) -> None:
        try:
            self.items: dict[str, dict] = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.items = {}
        self.by_hash = {item["tokenHash"]: device for device, item in self.items.items()}
        self.saved, self.stamp = time.time(), self._stamp()

    @staticmethod
    def _hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _save(self) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.items, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, self.path)
        self.saved, self.stamp = time.time(), self._stamp()

    def add(self, name: str, address: str) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        device = secrets.token_hex(6)
        with self.lock:
            if self._stamp() != self.stamp:
                self._load()
            now = time.time()
            self.items[device] = {"name": name, "tokenHash": self._hash(token), "added": now,
                                  "lastSeen": now, "address": address}
            self.by_hash[self._hash(token)] = device
            self._save()
        return device, token

    def find(self, token: str, address: str) -> str | None:
        if not token:
            return None
        with self.lock:
            if self._stamp() != self.stamp:
                self._load()  # changed by --revoke while the server runs
            device = self.by_hash.get(self._hash(token))
            if device is None:
                return None
            item = self.items[device]
            item["lastSeen"], item["address"] = time.time(), address
            if time.time() - self.saved > 300:
                self._save()
            return device

    def name(self, device: str | None) -> str:
        item = self.items.get(device or "")
        return item["name"] if item else "this PC"

    def remove(self, key: str) -> list[str]:
        with self.lock:
            self._load()
            gone = [device for device, item in self.items.items() if key in (device, item["name"])]
            for device in gone:
                self.by_hash.pop(self.items.pop(device)["tokenHash"], None)
            if gone:
                self._save()
            return gone


# ---------------------------------------------------------------- registration
@dataclass
class Request:
    id: str
    name: str
    address: str
    created: float = field(default_factory=time.time)
    status: str = "pending"  # pending -> approved / denied
    token: str | None = None


def ask_on_screen(name: str, address: str, code: str) -> bool:
    """A window on this PC that asks whether to let a new PC in. No answer within two minutes is a no."""
    import ctypes
    text = (f"“{name}” ({address}) wants to use UT Stems on this PC.\n\n"
            f"Confirmation code: {code}\n(the same code is shown on that PC)\n\n"
            "Allow it? It can then separate songs here until you remove it with\n"
            "python -m ut_stems.remote --revoke “name”.")
    # MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_SYSTEMMODAL | MB_SETFOREGROUND | MB_TOPMOST
    flags = 0x4 | 0x20 | 0x100 | 0x1000 | 0x10000 | 0x40000
    answer = ctypes.windll.user32.MessageBoxTimeoutW(None, text, "UT Stems Server: new PC", flags, 0,
                                                     APPROVAL_TIMEOUT * 1000)
    return answer == 6  # IDYES


class Registration:
    """New PCs ask to be let in. One question is on screen at a time, and the number of
    questions is limited, so that strangers on the internet cannot flood this PC with windows."""

    def __init__(self, devices: Devices, fingerprint: str, approve=ask_on_screen, log=print):
        self.devices, self.fingerprint, self.approve, self.log = devices, fingerprint, approve, log
        self.lock = threading.Lock()
        self.requests: dict[str, Request] = {}
        self.asking = False
        self.recent: list[float] = []  # times questions were shown, for the hourly limit
        self.blocked: dict[str, float] = {}  # address -> until when it may not ask again

    def start(self, name, address: str) -> dict:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("The PC needs a name.")
        name = " ".join(name.split())[:40]
        now = time.time()
        with self.lock:
            self.requests = {key: r for key, r in self.requests.items() if now - r.created < REQUEST_LIFETIME}
            self.recent = [t for t in self.recent if now - t < 3600]
            if self.blocked.get(address, 0) > now:
                raise PermissionError("This PC was turned down a moment ago. Try again in a minute.")
            if self.asking:
                raise PermissionError("Another PC is waiting for an answer on the server. Try again in a minute.")
            if len(self.recent) >= 20:
                raise PermissionError("Too many requests. Try again later.")
            self.asking = True
            self.recent.append(now)
            request = Request(secrets.token_urlsafe(16), name, address)
            self.requests[request.id] = request
        code = confirmation_code(request.id, self.fingerprint)
        threading.Thread(target=self._ask, args=(request, code), daemon=True).start()
        self.log(f"{name} ({address}) asks to register, code {code}")
        return {"request": request.id}

    def _ask(self, request: Request, code: str) -> None:
        try:
            allowed = bool(self.approve(request.name, request.address, code))
        except Exception as e:
            self.log(f"could not ask about {request.name}: {e}")
            allowed = False
        with self.lock:
            self.asking = False
            if allowed:
                device, request.token = self.devices.add(request.name, request.address)
                request.status = "approved"
            else:
                request.status = "denied"
                self.blocked[request.address] = time.time() + 60
        self.log(f"{request.name} {'registered' if allowed else 'turned down'}")

    def poll(self, request_id: str) -> dict:
        with self.lock:
            request = self.requests.get(request_id)
            if request is None:
                return {"status": "expired"}
            if request.status == "approved":
                del self.requests[request_id]  # the key is handed out once
                return {"status": "approved", "token": request.token}
            if request.status == "denied":
                del self.requests[request_id]
            return {"status": request.status}


# ---------------------------------------------------------------- server
class RemoteServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, data: Path, jobs: Path, approve=ask_on_screen, log=print,
                 name: str | None = None):
        self.log = log
        self.name = name or socket.gethostname()
        cert, key, self.fingerprint = ensure_certificate(data)
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.context.load_cert_chain(cert, key)
        self.devices = Devices(data / "devices.json")
        self.registration = Registration(self.devices, self.fingerprint, approve, log)
        self.slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        shutil.rmtree(jobs, ignore_errors=True)  # songs are not kept across restarts
        jobs.mkdir(parents=True, exist_ok=True)
        self.workspace = Workspace(output=jobs, jobs=jobs)
        self.workspace.on_event = lambda owner, message: log(f"{self.devices.name(owner)}: {message}")
        super().__init__(address, Handler)

    # TLS is negotiated on the connection's own thread, so a slow or broken client never holds up others.
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def finish_request(self, request, client_address):
        request.settimeout(30)
        request = self.context.wrap_socket(request, server_side=True)
        self.RequestHandlerClass(request, client_address, self)

    def handle_error(self, request, client_address):
        pass  # scanners, dropped connections and failed handshakes are not worth a trace

    def authenticate(self, given: str, handler) -> object:
        device = self.devices.find(given, handler.client_address[0])
        return DENIED if device is None else device

    def public_route(self, handler, method: str, path: str, query: dict) -> bool:
        address = handler.client_address[0]
        if path == "/api/hello" and method == "GET":
            handler.respond(200, {"service": "ut-stems", "name": self.name, "version": __version__})
            return True
        if path != "/api/register":
            return False
        try:
            if method == "POST":
                data = json.loads(handler.read_body(4096) or b"{}")
                handler.respond(200, self.registration.start(data.get("name") if isinstance(data, dict) else None,
                                                             address))
            else:
                handler.respond(200, self.registration.poll((query.get("request") or [""])[0]))
        except PermissionError as e:
            handler.refuse(429, str(e))
        except ValueError as e:
            handler.refuse(400, str(e))
        return True


def local_addresses() -> list[str]:
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except OSError:
        return []
    return sorted({info[4][0] for info in infos if not info[4][0].startswith(("127.", "169.254."))})


def nearby(sender: str, own: list[str]) -> bool:
    """Discovery is only answered on the local network, never to the wider internet."""
    try:
        address = ipaddress.ip_address(sender)
    except ValueError:
        return False
    if address.is_loopback or address.is_private:
        return True
    return any(address in ipaddress.ip_network(f"{mine}/24", strict=False) for mine in own)


def discovery(server: RemoteServer, port: int, stop: threading.Event) -> None:
    """Answer the broadcast of a client that looks for a server on this network."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", port))
    except OSError as e:
        server.log(f"automatic discovery is off: {e}")
        return
    sock.settimeout(1.0)
    reply = json.dumps({"service": "ut-stems", "name": server.name, "port": server.server_port,
                        "fingerprint": server.fingerprint, "version": __version__}).encode()
    own = local_addresses()
    while not stop.is_set():
        try:
            data, sender = sock.recvfrom(256)
        except socket.timeout:
            continue
        except OSError:
            continue  # e.g. ICMP port unreachable from an earlier reply
        if data == DISCOVER and nearby(sender[0], own):
            try:
                sock.sendto(reply, sender)
            except OSError:
                pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m ut_stems.remote", description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--data", type=Path, default=None, help="settings folder (default: %%APPDATA%%\\UT Stems Server)")
    parser.add_argument("--list", action="store_true", help="show the registered PCs")
    parser.add_argument("--revoke", metavar="PC", help="remove a registered PC by name or id")
    parser.add_argument("--test-approve-all", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")
    data = args.data or data_dir()
    data.mkdir(parents=True, exist_ok=True)

    if args.list or args.revoke:
        devices = Devices(data / "devices.json")
        if args.revoke:
            gone = devices.remove(args.revoke)
            print(f"removed {len(gone)} PC(s)" if gone else f"no registered PC is called {args.revoke}")
            return 0 if gone else 1
        if not devices.items:
            print("No PCs are registered.")
        for device, item in devices.items.items():
            seen = datetime.fromtimestamp(item["lastSeen"]).strftime("%Y-%m-%d %H:%M")
            print(f"{device}  {item['name']:<30} last seen {seen} from {item['address']}")
        return 0

    def log(message: str) -> None:
        print(f"{datetime.now():%H:%M:%S}  {message}", flush=True)

    approve = ask_on_screen
    host = "0.0.0.0"
    if args.test_approve_all:  # automated tests only: every request is allowed, so only this PC may connect
        approve, host = (lambda name, address, code: True), "127.0.0.1"
    server = RemoteServer((host, args.port), data, data / "jobs", approve=approve, log=log)
    stop = threading.Event()
    if not args.test_approve_all:
        threading.Thread(target=discovery, args=(server, args.port, stop), daemon=True).start()

    addresses = local_addresses()
    public = [a for a in addresses if ipaddress.ip_address(a).is_global]
    print(f"UT Stems Server {__version__} on {server.name}, port {server.server_port}")
    print(json.dumps({"port": server.server_port, "fingerprint": server.fingerprint}), flush=True)
    for address in addresses:
        if address in public:
            kind = "internet and this network"
        elif ipaddress.ip_address(address) in ipaddress.ip_network("100.64.0.0/10"):
            kind = "Tailscale"
        else:
            kind = "this network"
        print(f"  address {address}  ({kind})")
    if not public:
        print("  From outside this network, a client needs a forwarded port or a VPN.")
    print(f"  {len(server.devices.items)} registered PC(s). New PCs are asked about in a window on this PC.")
    print("  Keep this window open while others use the server. Ctrl+C stops it.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.workspace.cancel.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
