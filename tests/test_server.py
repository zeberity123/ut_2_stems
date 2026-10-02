"""The local server: session token, static files, the song queue and audio streaming."""

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from ut_stems.pipeline import Result, StemFile
from ut_stems.server import Song, make_server


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


def command(server, action, **values):
    status, body, _ = call(server, "/api/command", data={"action": action, **values})
    return status, json.loads(body)


def audio_file(tmp_path, name):
    path = tmp_path / name
    path.write_bytes(b"not really audio")
    return path


def test_api_needs_the_session_token(server):
    assert call(server, "/api/state", token=None)[0] == 403
    assert call(server, "/api/state", token="wrong")[0] == 403
    assert call(server, "/api/command", token=None, data={"action": "cancel"})[0] == 403
    status, body, _ = call(server, "/api/state")
    state = json.loads(body)
    assert status == 200
    assert state["stems"] == ["vocals", "bass", "drums", "guitars", "piano", "others"]
    assert state["busy"] is False and state["songs"] == [] and state["running"] is None


def test_static_files_and_path_traversal(server):
    status, body, headers = call(server, "/", token=None)
    assert status == 200 and b"UT Stems" in body
    assert headers["Content-Type"].startswith("text/html")
    assert call(server, "/app.js", token=None)[2]["Content-Type"].startswith("text/javascript")
    assert call(server, "/../ut_stems/server.py", token=None)[0] == 404
    assert call(server, "/..%2Fpyproject.toml", token=None)[0] == 404


def test_unknown_command_is_rejected(server):
    status, body = command(server, "format-disk")
    assert status == 400 and "Unknown action" in body["error"]


def test_adding_songs(server, tmp_path):
    status, body = command(server, "add", sources=[str(tmp_path / "missing.mp3")])
    assert status == 400 and "File not found" in body["error"]
    assert command(server, "add", sources="song.mp3")[0] == 400
    assert command(server, "add", sources=["  "])[0] == 400

    first = audio_file(tmp_path, "첫 번째 노래.mp3")
    # one bad entry refuses the whole request, so nothing is half-added
    status, _ = command(server, "add", sources=[str(first), str(tmp_path / "missing.mp3")])
    assert status == 400
    assert json.loads(call(server, "/api/state")[1])["songs"] == []

    status, state = command(server, "add", sources=[f'"{first}"', "https://youtu.be/CkvWJNt77mU"])
    assert status == 200
    assert [(song["title"], song["status"]) for song in state["songs"]] == [
        ("첫 번째 노래", "waiting"), ("https://youtu.be/CkvWJNt77mU", "waiting")]
    assert state["busy"] is False  # adding never starts anything


def test_start_validates_settings(server, tmp_path):
    assert "Add a song first" in command(server, "start")[1]["error"]
    command(server, "add", sources=[str(audio_file(tmp_path, "a.mp3"))])
    assert "at least one stem" in command(server, "start", stems=[])[1]["error"]
    assert "Unknown stems" in command(server, "start", stems=["kazoo"])[1]["error"]
    assert "Unknown model" in command(server, "start", model="magic")[1]["error"]
    assert "Overlap" in command(server, "start", overlap=9)[1]["error"]
    state = json.loads(call(server, "/api/state")[1])
    assert state["songs"][0]["status"] == "waiting" and state["busy"] is False


def test_queue_runs_every_song_and_reports_failures(server, tmp_path):
    # Neither file is real audio, so both fail at decoding, before any model is loaded.
    command(server, "add", sources=[str(audio_file(tmp_path, "a.mp3")), str(audio_file(tmp_path, "b.mp3"))])
    status, state = command(server, "start", stems=["vocals"])
    assert status == 200 and state["busy"] is True
    for _ in range(200):
        state = json.loads(call(server, "/api/state")[1])
        if not state["busy"]:
            break
        time.sleep(0.05)
    assert state["busy"] is False
    assert [song["status"] for song in state["songs"]] == ["failed", "failed"]
    assert all("could not decode" in song["error"] for song in state["songs"])

    # failed songs are not retried by a later start, and can be cleared
    assert "Add a song first" in command(server, "start")[1]["error"]
    assert command(server, "clear-finished")[1]["songs"] == []


def test_cancel_and_remove(server, tmp_path):
    command(server, "add", sources=[str(audio_file(tmp_path, name)) for name in ("a.mp3", "b.mp3", "c.mp3")])
    workspace = server.workspace
    first, second, third = workspace.songs
    first.status, second.status, third.status = "running", "queued", "queued"

    status, body = command(server, "remove", id=first.id)
    assert status == 400 and "Cancel" in body["error"]
    state = command(server, "remove", id=third.id)[1]
    assert [song["title"] for song in state["songs"]] == ["a", "b"]

    state = command(server, "cancel")[1]
    assert workspace.cancel.is_set()
    assert [(song["status"], song["message"]) for song in state["songs"]] == [
        ("running", "Cancelling…"), ("waiting", "")]


def test_results_and_audio_streaming(server, tmp_path):
    path = tmp_path / "song_vocals.mp3"
    path.write_bytes(bytes(range(100)))
    result = Result(song="song", source=path, folder=tmp_path, duration=1.0, seconds=1.4,
                    model="bs_roformer_sw", stems=[StemFile("vocals", path, -6.0, [0.5])])
    server.workspace.songs.append(Song(7, str(path), "song", status="done", result=result))
    server.workspace.songs.append(Song(8, "other.mp3", "other"))

    state = json.loads(call(server, "/api/state")[1])
    assert state["songs"][0] == {"id": 7, "title": "song", "status": "done", "message": "", "progress": 0.0,
                                 "error": None, "stems": 1, "seconds": 1}
    assert "peaks" not in json.dumps(state)  # waveforms are only sent on request

    status, body, _ = call(server, "/api/result?id=7")
    assert status == 200
    assert json.loads(body)["stems"] == [{"name": "vocals", "file": "song_vocals.mp3", "level": -6.0,
                                          "silent": False, "peaks": [0.5]}]
    assert call(server, "/api/result?id=8")[0] == 404  # not finished
    assert call(server, "/api/result?id=99")[0] == 404

    status, body, headers = call(server, "/api/audio?id=7&stem=vocals")
    assert status == 200 and body == bytes(range(100)) and headers["Accept-Ranges"] == "bytes"

    status, body, headers = call(server, "/api/audio?id=7&stem=vocals", headers={"Range": "bytes=10-19"})
    assert status == 206 and body == bytes(range(10, 20))
    assert headers["Content-Range"] == "bytes 10-19/100"

    status, body, _ = call(server, "/api/audio?id=7&stem=vocals", headers={"Range": "bytes=90-"})
    assert status == 206 and body == bytes(range(90, 100))

    assert call(server, "/api/audio?id=7&stem=vocals", headers={"Range": "bytes=500-"})[0] == 416
    assert call(server, "/api/audio?id=8&stem=vocals")[0] == 404
    assert call(server, "/api/audio?id=7&stem=piano")[0] == 404
    assert call(server, "/api/audio?id=7&stem=vocals", token=None)[0] == 403
    # the players cannot send headers, so the token is also accepted in the query string
    assert call(server, "/api/audio?id=7&stem=vocals&token=test-token", token=None)[0] == 200
