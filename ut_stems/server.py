"""Local web server behind the desktop app.

Serves the interface in ``web/`` and a small JSON API, bound to 127.0.0.1 and guarded
by a session token. Songs wait in a list and are separated one at a time on a worker thread.
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
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import DEFAULT_MODEL, MODEL_NAMES, STEMS, Cancelled, __version__

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
IDLE_MESSAGE = "Paste a YouTube link or choose audio files."


@dataclass
class Song:
    """One entry in the song list.

    status: waiting (added, not started) -> queued -> running -> done or failed.
    Cancelling puts unfinished songs back to waiting.
    """
    id: int
    source: str
    title: str
    status: str = "waiting"
    settings: dict | None = None
    message: str = ""
    progress: float = 0.0
    started: float = 0.0
    error: str | None = None
    result: object | None = None  # pipeline.Result once done


class Workspace:
    def __init__(self, output: Path | None = None):
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.default_output = Path(output or os.environ.get("UT_STEMS_OUTPUT") or ROOT / "output")
        self.songs: list[Song] = []
        self.next_id = 1
        self.busy = False  # the worker thread is alive
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
        except Exception as e:  # shown in the header instead of crashing the server
            device = f"unavailable: {e}"
        with self.lock:
            self.device = device

    # ------------------------------------------------------------ state
    def state(self) -> dict:
        with self.lock:
            running = next((song for song in self.songs if song.status == "running"), None)
            queued = sum(song.status == "queued" for song in self.songs)
            if running:
                message = running.message + (f" · {queued} more in the queue" if queued else "")
            else:
                message = IDLE_MESSAGE
            return {
                "version": __version__, "busy": self.busy, "message": message,
                "progress": round(running.progress, 4) if running else 0,
                "elapsed": round(time.time() - running.started, 1) if running else None,
                "running": running.id if running else None,
                "device": self.device, "stems": STEMS, "models": MODEL_NAMES,
                "defaultModel": DEFAULT_MODEL, "defaultOutput": str(self.default_output),
                "songs": [{
                    "id": song.id, "title": song.title, "status": song.status,
                    "message": song.message, "progress": round(song.progress, 4), "error": song.error,
                    "stems": len(song.result.stems) if song.result else None,
                    "seconds": round(song.result.seconds) if song.result else None,
                } for song in self.songs],
            }

    def result(self, song_id: str) -> dict | None:
        """The finished result of one song, including the waveform outlines."""
        with self.lock:
            song = self._find(song_id)
            if song is None or song.result is None:
                return None
            r = song.result
            return {
                "id": song.id, "song": r.song, "folder": str(r.folder),
                "duration": round(r.duration, 1), "seconds": round(r.seconds, 1), "model": r.model,
                "stems": [{"name": s.name, "file": s.path.name, "level": s.level_db,
                           "silent": s.level_db < -60, "peaks": s.peaks} for s in r.stems],
            }

    def stem_path(self, song_id: str, name: str) -> Path | None:
        with self.lock:
            song = self._find(song_id)
            if song is None or song.result is None:
                return None
            return next((s.path for s in song.result.stems if s.name == name), None)

    def _find(self, song_id) -> Song | None:
        return next((song for song in self.songs if str(song.id) == str(song_id)), None)

    # ------------------------------------------------------------ commands
    def command(self, action: str, data: dict) -> dict:
        if action == "add":
            self.add(data.get("sources"))
        elif action == "start":
            self.start(data)
        elif action == "remove":
            with self.lock:
                song = self._find(data.get("id"))
                if song is not None and song.status == "running":
                    raise ValueError("Cancel the song before removing it.")
                if song is not None:
                    self.songs.remove(song)
        elif action == "clear-finished":
            with self.lock:
                self.songs = [song for song in self.songs if song.status not in ("done", "failed")]
        elif action == "cancel":
            with self.lock:
                self.cancel.set()
                for song in self.songs:
                    if song.status == "queued":
                        song.status, song.settings, song.message = "waiting", None, ""
                    elif song.status == "running":
                        song.message = "Cancelling…"
        elif action == "open-folder":
            with self.lock:
                song = self._find(data.get("id"))
                folder = song.result.folder if song is not None and song.result else None
            if folder is None or not folder.is_dir():
                raise ValueError("There is no output folder to open yet.")
            os.startfile(folder)  # the folder of a finished song only, never a caller-supplied path
        else:
            raise ValueError(f"Unknown action: {action}")
        return self.state()

    def add(self, sources) -> None:
        """Add songs to the list. They wait there until ``start``."""
        from .youtube import is_url
        if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
            raise ValueError("Sources must be a list of links or file paths.")
        cleaned = [source.strip().strip('"') for source in sources]
        cleaned = [source for source in cleaned if source]
        if not cleaned:
            raise ValueError("Paste a YouTube link or choose an audio file.")
        missing = [source for source in cleaned
                   if not is_url(source) and not Path(source).expanduser().is_file()]
        if missing:
            raise ValueError("File not found: " + ", ".join(missing))
        with self.lock:
            for source in cleaned:
                title = source if is_url(source) else Path(source).stem
                self.songs.append(Song(self.next_id, source, title))
                self.next_id += 1

    def start(self, data: dict) -> None:
        """Queue every waiting song with the given settings and make sure the worker runs."""
        stems = data.get("stems", list(STEMS))
        if not isinstance(stems, list) or not all(isinstance(s, str) for s in stems):
            raise ValueError("Stems must be a list of names.")
        if set(stems) - set(STEMS):
            raise ValueError(f"Unknown stems: {sorted(set(stems) - set(STEMS))}")
        if not stems:
            raise ValueError("Select at least one stem.")
        model = data.get("model") or DEFAULT_MODEL
        if model not in MODEL_NAMES:
            raise ValueError(f"Unknown model: {model}")
        overlap = int(data.get("overlap") or 2)
        if overlap not in (2, 3, 4):
            raise ValueError("Overlap must be 2, 3 or 4.")
        settings = {"stems": stems, "model": model, "overlap": overlap,
                    "out_dir": Path(str(data.get("output") or self.default_output))}
        with self.lock:
            waiting = [song for song in self.songs if song.status == "waiting"]
            if not waiting:
                raise ValueError("Add a song first.")
            for song in waiting:
                song.status, song.settings = "queued", settings
                song.message, song.progress, song.error = "In the queue", 0.0, None
            if not self.busy:
                self.busy = True
                threading.Thread(target=self._work, daemon=True).start()

    def _work(self) -> None:
        from .pipeline import run
        while True:
            with self.lock:
                song = next((song for song in self.songs if song.status == "queued"), None)
                if song is None:
                    self.busy = False
                    return
                song.status, song.message, song.started = "running", "Starting…", time.time()
                settings = song.settings
                self.cancel.clear()

            def report(message, fraction, song=song):
                with self.lock:
                    if not self.cancel.is_set():
                        song.message, song.progress = message, fraction

            def on_song(name, song=song):
                with self.lock:
                    song.title = name

            try:
                result = run(song.source, report=report, cancel=self.cancel, on_song=on_song, **settings)
                with self.lock:
                    song.status, song.result, song.progress = "done", result, 1.0
                    song.message = f"Done in {result.seconds:.0f} s · {len(result.stems)} stems"
            except Cancelled:
                with self.lock:
                    song.status, song.settings = "waiting", None
                    song.message, song.progress = "Cancelled", 0.0
            except Exception as e:
                with self.lock:
                    song.status, song.progress = "failed", 0.0
                    song.error = str(e) or type(e).__name__
                    song.message = "Failed"


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
            workspace = self.server.workspace
            if url.path == "/api/state":
                return self.respond(200, workspace.state())
            if url.path == "/api/result":
                result = workspace.result((query.get("id") or [""])[0])
                if result is None:
                    return self.respond(404, {"error": "That song has no result."})
                return self.respond(200, result)
            if url.path == "/api/audio":
                path = workspace.stem_path((query.get("id") or [""])[0], (query.get("stem") or [""])[0])
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
