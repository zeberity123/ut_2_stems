"""Local web server behind the desktop app.

Serves the interface in ``web/`` and a small JSON API, bound to 127.0.0.1 and guarded
by a session token. One separation job runs at a time on a worker thread.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import DEFAULT_MODEL, MODEL_NAMES, STEMS, Cancelled, __version__

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
IDLE_MESSAGE = "Paste a YouTube link or choose an audio file."


class Workspace:
    def __init__(self, output: Path | None = None):
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.default_output = Path(output or os.environ.get("UT_STEMS_OUTPUT") or ROOT / "output")
        self.busy = False
        self.message = IDLE_MESSAGE
        self.progress = 0.0
        self.started = 0.0
        self.error = None
        self.result = None  # pipeline.Result of the last finished job
        self.job = 0
        self.device = None
        threading.Thread(target=self._warm_up, daemon=True).start()

    def _warm_up(self):
        """Import torch in the background so the first job starts sooner."""
        try:
            import torch
            if torch.cuda.is_available():
                device = torch.cuda.get_device_name(0).replace("NVIDIA GeForce ", "")
            else:
                device = "CPU (slow)"
        except Exception as e:  # shown in the status bar instead of crashing the server
            device = f"unavailable: {e}"
        with self.lock:
            self.device = device

    def state(self) -> dict:
        with self.lock:
            result = None
            if self.result:
                r = self.result
                result = {
                    "job": self.job, "song": r.song, "folder": str(r.folder),
                    "duration": round(r.duration, 1), "seconds": round(r.seconds, 1),
                    "model": r.model,
                    "stems": [{"name": s.name, "file": s.path.name, "level": s.level_db,
                               "silent": s.level_db < -60, "peaks": s.peaks} for s in r.stems],
                }
            return {
                "version": __version__, "busy": self.busy, "message": self.message,
                "progress": round(self.progress, 4), "error": self.error,
                "elapsed": round(time.time() - self.started, 1) if self.busy else None,
                "device": self.device, "stems": STEMS, "models": MODEL_NAMES,
                "defaultModel": DEFAULT_MODEL, "defaultOutput": str(self.default_output),
                "result": result,
            }

    def report(self, message: str, fraction: float) -> None:
        with self.lock:
            self.message, self.progress = message, fraction

    def command(self, action: str, data: dict) -> dict:
        if action == "separate":
            self.start(data)
        elif action == "cancel":
            self.cancel.set()
            self.report("Cancelling…", self.progress)
        elif action == "dismiss-error":
            with self.lock:
                self.error = None
        elif action == "open-folder":
            with self.lock:
                folder = self.result.folder if self.result else None
            if folder is None or not folder.is_dir():
                raise ValueError("There is no output folder to open yet.")
            os.startfile(folder)  # the folder of the last result only, never a caller-supplied path
        else:
            raise ValueError(f"Unknown action: {action}")
        return self.state()

    def start(self, data: dict) -> None:
        source = str(data.get("source") or "")
        stems = data.get("stems", list(STEMS))
        output = Path(str(data.get("output") or self.default_output))
        model = data.get("model") or DEFAULT_MODEL
        overlap = int(data.get("overlap") or 2)
        if overlap not in (2, 3, 4):
            raise ValueError("Overlap must be 2, 3 or 4.")
        if not isinstance(stems, list) or not all(isinstance(s, str) for s in stems):
            raise ValueError("Stems must be a list of names.")
        with self.lock:
            if self.busy:
                raise ValueError("A song is already being separated.")
            self.busy, self.error, self.progress = True, None, 0.0
            self.message, self.started = "Starting…", time.time()
            self.cancel.clear()

        def work():
            from .pipeline import run
            try:
                result = run(source, output, stems=stems, model=model, overlap=overlap,
                             report=self.report, cancel=self.cancel)
                with self.lock:
                    self.result, self.job = result, self.job + 1
                    self.message = f"Done in {result.seconds:.0f} s · {len(result.stems)} stems"
                    self.progress = 1.0
            except Cancelled:
                with self.lock:
                    self.message, self.progress = "Cancelled.", 0.0
            except Exception as e:
                with self.lock:
                    self.error = str(e) or type(e).__name__
                    self.message, self.progress = "Something went wrong.", 0.0
            finally:
                with self.lock:
                    self.busy = False

        threading.Thread(target=work, daemon=True).start()

    def stem_path(self, job: str, name: str) -> Path | None:
        with self.lock:
            if not self.result or str(self.job) != job:
                return None
            return next((s.path for s in self.result.stems if s.name == name), None)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def respond(self, status: int, data, content_type: str = "application/json"):
        body = json.dumps(data).encode("utf-8") if content_type == "application/json" else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self, query: dict) -> bool:
        given = self.headers.get("X-Session-Token") or (query.get("token") or [""])[0]
        return secrets.compare_digest(given, self.server.token)

    def send_file(self, path: Path, content_type: str):
        """Send a file with Range support so the audio players can seek."""
        size = path.stat().st_size
        start, end = 0, size - 1
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            else:
                start = max(size - int(match.group(2)), 0)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        remaining = end - start + 1
        try:
            with open(path, "rb") as f:
                f.seek(start)
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionError, OSError):
            pass  # the player dropped the connection, e.g. on seek

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        if url.path.startswith("/api/"):
            if not self.authorized(query):
                return self.respond(403, {"error": "Invalid session."})
            if url.path == "/api/state":
                return self.respond(200, self.server.workspace.state())
            if url.path == "/api/audio":
                path = self.server.workspace.stem_path((query.get("job") or [""])[0],
                                                       (query.get("stem") or [""])[0])
                if path is None or not path.is_file():
                    return self.respond(404, {"error": "That stem is not available."})
                return self.send_file(path, "audio/mpeg")
            return self.respond(404, {"error": "Not found."})
        name = "index.html" if url.path == "/" else url.path.lstrip("/")
        target = (WEB / name).resolve()
        if WEB.resolve() not in target.parents or not target.is_file():
            return self.respond(404, {"error": "Not found."})
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            kind = "text/javascript"
        self.respond(200, target.read_bytes(), kind + ("; charset=utf-8" if kind.startswith("text/") else ""))

    def do_POST(self):
        url = urlsplit(self.path)
        if not self.authorized({}):
            return self.respond(403, {"error": "Invalid session."})
        if url.path != "/api/command":
            return self.respond(404, {"error": "Not found."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            self.respond(200, self.server.workspace.command(str(data.get("action")), data))
        except (ValueError, OSError) as e:
            self.respond(400, {"error": str(e)})


def make_server(host: str = "127.0.0.1", port: int = 0, token: str | None = None,
                output: Path | None = None) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.token = token or secrets.token_hex(32)
    server.workspace = Workspace(output)
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m ut_stems.server")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--open", action="store_true", help="open the interface in the browser")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")
    server = make_server(port=args.port, token=os.environ.get("UT_STEMS_TOKEN"))
    url = f"http://127.0.0.1:{server.server_port}/#{server.token}"
    print(json.dumps({"port": server.server_port, "url": url}), flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.workspace.cancel.set()
        server.server_close()


if __name__ == "__main__":
    main()
