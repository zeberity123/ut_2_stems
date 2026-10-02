"""The local server: session token, static files, job errors and audio streaming."""

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from ut_stems.pipeline import Result, StemFile
from ut_stems.server import make_server


@pytest.fixture
def server(tmp_path):
    instance = make_server(port=0, token="test-token", output=tmp_path / "out")
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()


def call(server, path, token="test-token", data=None, headers=None):
    request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{path}",
                                     data=None if data is None else json.dumps(data).encode())
    if token:
        request.add_header("X-Session-Token", token)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def test_api_needs_the_session_token(server):
    assert call(server, "/api/state", token=None)[0] == 403
    assert call(server, "/api/state", token="wrong")[0] == 403
    assert call(server, "/api/command", token=None, data={"action": "cancel"})[0] == 403
    status, body, _ = call(server, "/api/state")
    state = json.loads(body)
    assert status == 200
    assert state["stems"] == ["vocals", "bass", "drums", "guitars", "piano", "others"]
    assert state["busy"] is False and state["result"] is None


def test_static_files_and_path_traversal(server):
    status, body, headers = call(server, "/", token=None)
    assert status == 200 and b"UT Stems" in body
    assert headers["Content-Type"].startswith("text/html")
    assert call(server, "/app.js", token=None)[2]["Content-Type"].startswith("text/javascript")
    assert call(server, "/../ut_stems/server.py", token=None)[0] == 404
    assert call(server, "/..%2Fpyproject.toml", token=None)[0] == 404


def test_unknown_command_is_rejected(server):
    status, body, _ = call(server, "/api/command", data={"action": "format-disk"})
    assert status == 400 and "Unknown action" in json.loads(body)["error"]


def test_failed_job_reports_the_error(server, tmp_path):
    status, _, _ = call(server, "/api/command",
                        data={"action": "separate", "source": str(tmp_path / "missing.mp3")})
    assert status == 200
    for _ in range(100):
        state = json.loads(call(server, "/api/state")[1])
        if not state["busy"]:
            break
        time.sleep(0.05)
    assert state["busy"] is False
    assert "File not found" in state["error"]
    state = json.loads(call(server, "/api/command", data={"action": "dismiss-error"})[1])
    assert state["error"] is None


def test_audio_streaming_supports_ranges(server, tmp_path):
    path = tmp_path / "song_vocals.mp3"
    path.write_bytes(bytes(range(100)))
    workspace = server.workspace
    workspace.result = Result(song="song", source=path, folder=tmp_path, duration=1.0, seconds=1.0,
                              model="bs_roformer_sw", stems=[StemFile("vocals", path, -6.0, [0.5])])
    workspace.job = 7

    status, body, headers = call(server, "/api/audio?job=7&stem=vocals")
    assert status == 200 and body == bytes(range(100)) and headers["Accept-Ranges"] == "bytes"

    status, body, headers = call(server, "/api/audio?job=7&stem=vocals", headers={"Range": "bytes=10-19"})
    assert status == 206 and body == bytes(range(10, 20))
    assert headers["Content-Range"] == "bytes 10-19/100"

    status, body, _ = call(server, "/api/audio?job=7&stem=vocals", headers={"Range": "bytes=90-"})
    assert status == 206 and body == bytes(range(90, 100))

    assert call(server, "/api/audio?job=7&stem=vocals", headers={"Range": "bytes=500-"})[0] == 416
    assert call(server, "/api/audio?job=6&stem=vocals")[0] == 404  # a stale job id
    assert call(server, "/api/audio?job=7&stem=piano")[0] == 404
    assert call(server, "/api/audio?job=7&stem=vocals", token=None)[0] == 403
    # the players cannot send headers, so the token is also accepted in the query string
    assert call(server, "/api/audio?job=7&stem=vocals&token=test-token", token=None)[0] == 200

    state = json.loads(call(server, "/api/state")[1])
    assert state["result"]["stems"][0] == {"name": "vocals", "file": "song_vocals.mp3", "level": -6.0,
                                           "silent": False, "peaks": [0.5]}
