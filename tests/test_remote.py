"""The server for other PCs: TLS, registration, one PC's songs kept from another, uploads, discovery."""

import hashlib
import http.client
import json
import socket
import ssl
import threading
import time

import pytest

from ut_stems.pipeline import Result, StemFile
from ut_stems.remote import DISCOVER, Devices, RemoteServer, confirmation_code, discovery


class Approver:
    """Stands in for the window on the server PC."""

    def __init__(self):
        self.answer = True
        self.asked = []
        self.release = threading.Event()
        self.release.set()

    def __call__(self, name, address, code):
        self.asked.append((name, address, code))
        self.release.wait(10)
        return self.answer


@pytest.fixture
def remote(tmp_path):
    approver = Approver()
    server = RemoteServer(("127.0.0.1", 0), tmp_path / "data", tmp_path / "jobs", approve=approver,
                          log=lambda message: None)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.approver = approver
    yield server
    server.shutdown()
    server.server_close()


def call(server, method, path, token=None, body=None, headers=None, raw=False):
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE  # the client pins the fingerprint instead
    connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=context, timeout=10)
    headers = dict(headers or {})
    if token:
        headers["X-Session-Token"] = token
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    data = response.read()
    certificate = connection.sock.getpeercert(binary_form=True)
    connection.close()
    return response.status, (data if raw else json.loads(data or b"null")), certificate


def register(server, name="Laptop"):
    status, body, _ = call(server, "POST", "/api/register", body={"name": name})
    assert status == 200, body
    for _ in range(100):
        status, poll, _ = call(server, "GET", f"/api/register?request={body['request']}")
        if poll["status"] != "pending":
            return body["request"], poll
        time.sleep(0.05)
    raise AssertionError("no answer")


def command(server, token, action, **values):
    return call(server, "POST", "/api/command", token, {"action": action, **values})[:2]


def test_tls_and_the_pinned_fingerprint(remote):
    status, body, certificate = call(remote, "GET", "/api/hello")
    assert status == 200 and body["service"] == "ut-stems"
    assert hashlib.sha256(certificate).hexdigest() == remote.fingerprint
    assert call(remote, "GET", "/api/state")[0] == 403
    assert call(remote, "GET", "/api/state", token="made-up")[0] == 403
    assert call(remote, "GET", "/", raw=True)[0] == 200  # the interface itself is not secret


def test_registration_is_approved_on_the_server(remote):
    request, poll = register(remote, "  Office   laptop  ")
    assert poll["status"] == "approved" and poll["token"]
    name, address, code = remote.approver.asked[0]
    assert (name, address) == ("Office laptop", "127.0.0.1")
    assert code == confirmation_code(request, remote.fingerprint)
    # the key is handed out once
    assert call(remote, "GET", f"/api/register?request={request}")[1] == {"status": "expired"}

    status, state, _ = call(remote, "GET", "/api/state", poll["token"])
    assert status == 200 and state["remote"] is True and state["songs"] == []

    # removing the PC on the server shuts it out, also when --revoke runs while the server does
    assert remote.devices.remove("Office laptop")
    assert call(remote, "GET", "/api/state", poll["token"])[0] == 403
    _, other = register(remote, "Other")
    assert call(remote, "GET", "/api/state", other["token"])[0] == 200
    assert Devices(remote.devices.path).remove("Other")  # what --revoke does
    assert call(remote, "GET", "/api/state", other["token"])[0] == 403


def test_turned_down_pcs_wait_and_only_one_question_at_a_time(remote):
    remote.approver.answer = False
    _, poll = register(remote)
    assert poll == {"status": "denied"}
    status, body, _ = call(remote, "POST", "/api/register", body={"name": "Again"})
    assert status == 429 and "turned down" in body["error"]

    remote.registration.blocked.clear()
    remote.approver.release.clear()  # the window stays open
    assert call(remote, "POST", "/api/register", body={"name": "First"})[0] == 200
    status, body, _ = call(remote, "POST", "/api/register", body={"name": "Second"})
    assert status == 429 and "waiting for an answer" in body["error"]
    remote.approver.release.set()
    assert call(remote, "POST", "/api/register", body={"name": ""})[0] in (400, 429)


def test_each_pc_sees_only_its_own_songs(remote, tmp_path, monkeypatch):
    _, a = register(remote, "A")
    _, b = register(remote, "B")
    a, b = a["token"], b["token"]

    # files on the server cannot be named; links are fine
    secret = tmp_path / "secret.mp3"
    secret.write_bytes(b"x")
    status, body = command(remote, a, "add", sources=[str(secret)])
    assert status == 400 and "uploaded" in body["error"]
    for link in ("http://127.0.0.1:8080/admin", "https://example.com/song.mp3", "https://youtube.com.evil.net/x"):
        status, body = command(remote, a, "add", sources=[link])
        assert status == 400 and "Only YouTube links" in body["error"]
    assert command(remote, a, "add", sources=["https://music.youtube.com/watch?v=1"])[0] == 200
    command(remote, a, "clear-finished")
    remote.workspace.songs.clear()
    status, state = command(remote, a, "add", sources=["https://youtu.be/abc"])
    assert status == 200 and [song["title"] for song in state["songs"]] == ["https://youtu.be/abc"]
    assert call(remote, "GET", "/api/state", b)[1]["songs"] == []
    assert command(remote, a, "open-folder", id=state["songs"][0]["id"])[0] == 400

    # B cannot remove, rename, start or cancel A's song
    song_id = state["songs"][0]["id"]
    command(remote, b, "remove", id=song_id)
    command(remote, b, "rename", id=song_id, name="mine now")
    assert "Add a song first" in command(remote, b, "start", stems=["vocals"])[1]["error"]
    assert call(remote, "GET", "/api/state", a)[1]["songs"][0]["title"] == "https://youtu.be/abc"

    # the output folder is chosen by the server, whatever the client sends
    seen = {}

    def fake_run(source, out_dir, **settings):
        seen["out_dir"] = out_dir
        out_dir.mkdir(parents=True)
        stem = out_dir / "song_vocals.mp3"
        stem.write_bytes(b"vocals")
        return Result(song="song", source=out_dir / "song.mp3", folder=out_dir, duration=1.0, seconds=1.0,
                      model="bs_roformer_sw", stems=[StemFile("vocals", stem, -3.0, [0.5])])

    monkeypatch.setattr("ut_stems.pipeline.run", fake_run)
    command(remote, a, "start", stems=["vocals"], output=r"C:\Windows\System32")
    for _ in range(100):
        state = call(remote, "GET", "/api/state", a)[1]
        if state["songs"][0]["status"] == "done":
            break
        time.sleep(0.05)
    owner = remote.devices.by_hash[remote.devices._hash(a)]
    assert seen["out_dir"] == remote.workspace.jobs / owner / str(song_id)

    result = call(remote, "GET", f"/api/result?id={song_id}", a)[1]
    assert result["folder"] == "" and result["stems"][0]["file"] == "song_vocals.mp3"
    status, data, _ = call(remote, "GET", f"/api/file?id={song_id}&name=song_vocals.mp3", a, raw=True)
    assert status == 200 and data == b"vocals"
    for path in (f"/api/result?id={song_id}", f"/api/audio?id={song_id}&stem=vocals",
                 f"/api/file?id={song_id}&name=song_vocals.mp3"):
        assert call(remote, "GET", path, b, raw=True)[0] == 404
    assert call(remote, "GET", f"/api/file?id={song_id}&name=..%5C..%5Cdevices.json", a, raw=True)[0] == 404

    # clearing the song deletes what the server kept for it
    command(remote, a, "clear-finished")
    assert not seen["out_dir"].exists()


def test_uploads(remote):
    _, a = register(remote, "A")
    token = a["token"]
    status, body, _ = call(remote, "POST", "/api/upload?name=..%5Cevil.exe", token, b"MZ")
    assert status == 400 and "not an audio file" in body["error"]
    status, body, _ = call(remote, "POST", "/api/upload?name=empty.mp3", token, b"")
    assert status == 400
    status, body, _ = call(remote, "POST", "/api/upload?name=C%3A%5Cmusic%5Cmy%20song.mp3", token, b"audio")
    assert status == 200 and [s["title"] for s in body["songs"]] == ["my song"]
    song = remote.workspace.songs[0]
    assert song.upload.read_bytes() == b"audio"
    assert remote.workspace.jobs in song.upload.parents
    # a session of this PC's own window has no upload; the remote server has no such session
    assert call(remote, "POST", "/api/upload?name=a.mp3", None, b"audio")[0] == 403
    command(remote, token, "remove", id=body["id"])
    assert not song.upload.exists()


def test_discovery_answers_on_the_local_network(remote):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1] + 1
    stop = threading.Event()
    threading.Thread(target=discovery, args=(remote, port, stop), daemon=True).start()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
            client.settimeout(0.5)
            reply = None
            for _ in range(10):
                client.sendto(DISCOVER, ("127.0.0.1", port))
                try:
                    reply = json.loads(client.recvfrom(1024)[0])
                    break
                except socket.timeout:
                    continue
            assert reply == {"service": "ut-stems", "name": remote.name, "port": remote.server_port,
                             "fingerprint": remote.fingerprint, "version": reply["version"]}
            client.sendto(b"anything else", ("127.0.0.1", port))
            with pytest.raises(socket.timeout):
                client.recvfrom(1024)
    finally:
        stop.set()


def test_a_refused_request_leaves_the_connection_usable(remote):
    """Clients keep connections open; a turned-down body must not spill into the next request."""
    _, a = register(remote, "A")
    context = ssl.create_default_context()
    context.check_hostname, context.verify_mode = False, ssl.CERT_NONE
    connection = http.client.HTTPSConnection("127.0.0.1", remote.server_port, context=context, timeout=10)
    try:
        for path, token in (("/api/upload?name=x.exe", a["token"]), ("/api/upload?name=x.mp3", "wrong"),
                            ("/api/nowhere", a["token"])):
            connection.request("POST", path, body=b"0123456789" * 100, headers={"X-Session-Token": token})
            response = connection.getresponse()
            assert response.status in (400, 403, 404)
            response.read()
            connection.request("GET", "/api/state", headers={"X-Session-Token": a["token"]})
            response = connection.getresponse()
            assert response.status == 200 and json.loads(response.read())["remote"] is True
    finally:
        connection.close()
