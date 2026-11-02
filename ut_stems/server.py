"""Local web server behind the desktop app.

Serves the interface in ``web/`` and a small JSON API, bound to 127.0.0.1 and guarded
by a session token. Songs wait in a list and are separated one at a time on a worker thread.

The same workspace also serves other PCs through ``remote.py``. Every song then belongs to
the PC that added it (its *owner*); a PC only sees and changes its own songs, cannot name
files on this PC, and its files are written to a folder of its own.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from . import DEFAULT_MODEL, MODEL_NAMES, STEMS, Cancelled, __version__
from .paths import WEB, default_output
IDLE_MESSAGE = "Paste a YouTube link or choose audio files."
DENIED = object()  # what ``authenticate`` returns for a caller without a valid token
MAX_UPLOAD = 2 * 1024 ** 3
UPLOAD_TYPES = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".mp4", ".webm", ".mkv"}


@dataclass
class Song:
    """One entry in the song list.

    status: waiting (added, not started) -> queued -> running -> done or failed.
    Cancelling puts unfinished songs back to waiting.
    """
    id: int
    source: str
    title: str
    name: str | None = None  # set by renaming before separation; replaces the song name in the files
    status: str = "waiting"
    settings: dict | None = None
    message: str = ""
    progress: float = 0.0
    started: float = 0.0
    error: str | None = None
    result: object | None = None  # pipeline.Result once done
    owner: str | None = None  # the PC that added the song; None for this PC's own window
    upload: Path | None = None  # the uploaded file of a song that came from another PC


def youtube_link(url: str) -> bool:
    host = (urlsplit(url.strip()).hostname or "").lower()
    return host in ("youtu.be", "youtube.com") or host.endswith(".youtube.com")


class Workspace:
    def __init__(self, output: Path | None = None, jobs: Path | None = None):
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.default_output = Path(output) if output else default_output()
        self.jobs = Path(jobs) if jobs else None  # where the songs of other PCs are worked on
        self.songs: list[Song] = []
        self.next_id = 1
        self.boot = secrets.token_hex(6)  # song ids start again at 1 after a restart; this tells them apart
        self.busy = False  # the worker thread is alive
        self.device = None
        self.on_event = lambda owner, message: None  # activity log of the server console
        threading.Thread(target=self._warm_up, daemon=True).start()

    def _warm_up(self):
        """Import torch in the background so the first job starts sooner."""
        try:
            import torch
            from .models import accelerator_available
            if accelerator_available("cuda"):
                device = torch.cuda.get_device_name(0).replace("NVIDIA GeForce ", "")
            elif accelerator_available("xpu"):
                device = torch.xpu.get_device_name(0).replace("Intel(R) ", "").replace("(TM)", "")
            else:
                device = "CPU · no supported GPU found"
        except Exception as e:  # shown in the header instead of crashing the server
            device = f"unavailable: {e}"
        with self.lock:
            self.device = device

    # ------------------------------------------------------------ state
    def state(self, owner: str | None = None) -> dict:
        with self.lock:
            mine = [song for song in self.songs if song.owner == owner]
            running = next((song for song in mine if song.status == "running"), None)
            queued = sum(song.status == "queued" for song in mine)
            if running:
                message = running.message + (f" · {queued} more in the queue" if queued else "")
            elif queued:
                message = "Waiting for another PC's song to finish" + (
                    f" · {queued} songs in the queue" if queued > 1 else "")
            else:
                message = IDLE_MESSAGE
            return {
                "version": __version__, "busy": bool(running or queued), "message": message,
                "progress": round(running.progress, 4) if running else 0,
                "elapsed": round(time.time() - running.started, 1) if running else None,
                "running": running.id if running else None,
                "device": self.device, "stems": STEMS, "models": MODEL_NAMES,
                "defaultModel": DEFAULT_MODEL, "defaultOutput": str(self.default_output),
                "remote": owner is not None, "boot": self.boot,
                "songs": [{
                    "id": song.id, "title": song.title, "status": song.status,
                    "message": song.message, "progress": round(song.progress, 4), "error": song.error,
                    "stems": len(song.result.stems) if song.result else None,
                    "seconds": round(song.result.seconds) if song.result else None,
                } for song in mine],
            }

    def result(self, song_id: str, owner: str | None = None) -> dict | None:
        """The finished result of one song, including the waveform outlines."""
        with self.lock:
            song = self._find(song_id, owner)
            if song is None or song.result is None:
                return None
            r = song.result
            original = r.original.name if r.original is not None and r.original.is_file() else None
            return {
                "id": song.id, "song": r.song, "folder": str(r.folder) if owner is None else "",
                "duration": round(r.duration, 1), "seconds": round(r.seconds, 1), "model": r.model,
                "original": original,
                "stems": [{"name": s.name, "file": s.path.name, "level": s.level_db,
                           "silent": s.level_db < -60, "peaks": s.peaks} for s in r.stems],
            }

    def stem_path(self, song_id: str, name: str, owner: str | None = None) -> Path | None:
        with self.lock:
            song = self._find(song_id, owner)
            if song is None or song.result is None:
                return None
            return next((s.path for s in song.result.stems if s.name == name), None)

    def file_path(self, song_id: str, file: str, owner: str | None = None) -> Path | None:
        """One of the files written for a finished song (a stem or the kept original), by file name."""
        with self.lock:
            song = self._find(song_id, owner)
            if song is None or song.result is None:
                return None
            files = [s.path for s in song.result.stems]
            if song.result.original is not None:
                files.append(song.result.original)
            return next((path for path in files if path.name == file), None)

    def _find(self, song_id, owner: str | None = None) -> Song | None:
        return next((song for song in self.songs
                     if str(song.id) == str(song_id) and song.owner == owner), None)

    def _discard(self, song: Song) -> None:
        """Delete what this PC keeps for another PC's song. Call with the lock held."""
        if song.owner is None or self.jobs is None:
            return
        shutil.rmtree(self._job_folder(song), ignore_errors=True)
        if song.upload is not None:
            shutil.rmtree(song.upload.parent, ignore_errors=True)

    def _job_folder(self, song: Song) -> Path:
        return self.jobs / song.owner / str(song.id)

    # ------------------------------------------------------------ commands
    def command(self, action: str, data: dict, owner: str | None = None) -> dict:
        if action == "add":
            self.add(data.get("sources"), owner)
        elif action == "start":
            self.start(data, owner)
        elif action == "remove":
            with self.lock:
                song = self._find(data.get("id"), owner)
                if song is not None and song.status == "running":
                    raise ValueError("Cancel the song before removing it.")
                if song is not None:
                    self.songs.remove(song)
                    self._discard(song)
        elif action == "rename":
            self.rename(data.get("id"), data.get("name"), owner)
        elif action == "clear-finished":
            with self.lock:
                finished = [song for song in self.songs
                            if song.owner == owner and song.status in ("done", "failed")]
                for song in finished:
                    self.songs.remove(song)
                    self._discard(song)
        elif action == "cancel":
            with self.lock:
                for song in self.songs:
                    if song.owner != owner:
                        continue
                    if song.status == "queued":
                        song.status, song.settings, song.message = "waiting", None, ""
                    elif song.status == "running":
                        song.message = "Cancelling…"
                        self.cancel.set()  # only ever the caller's own song
        elif action == "open-folder":
            if owner is not None:
                raise ValueError("The files are on your PC; open the folder there.")
            with self.lock:
                song = self._find(data.get("id"))
                folder = song.result.folder if song is not None and song.result else None
            if folder is None or not folder.is_dir():
                raise ValueError("There is no output folder to open yet.")
            os.startfile(folder)  # the folder of a finished song only, never a caller-supplied path
        else:
            raise ValueError(f"Unknown action: {action}")
        return self.state(owner)

    def add(self, sources, owner: str | None = None) -> None:
        """Add songs to the list. They wait there until ``start``."""
        from .youtube import is_url
        if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
            raise ValueError("Sources must be a list of links or file paths.")
        cleaned = [source.strip().strip('"') for source in sources]
        cleaned = [source for source in cleaned if source]
        if not cleaned:
            raise ValueError("Paste a YouTube link or choose an audio file.")
        if owner is not None:
            # Another PC names its own files, which mean nothing here; it uploads them instead.
            if not all(is_url(source) for source in cleaned):
                raise ValueError("Only links can be added this way; files are uploaded.")
            # Nor may it make this PC fetch any other address (say, on this PC's own network).
            if not all(youtube_link(source) for source in cleaned):
                raise ValueError("Only YouTube links can be separated on the server.")
        else:
            missing = [source for source in cleaned
                       if not is_url(source) and not Path(source).expanduser().is_file()]
            if missing:
                raise ValueError("File not found: " + ", ".join(missing))
        with self.lock:
            for source in cleaned:
                title = source if is_url(source) else Path(source).stem
                self.songs.append(Song(self.next_id, source, title, owner=owner))
                self.next_id += 1

    def check_upload(self, filename: str, length: int) -> str:
        """The name a file from another PC is stored under, or ValueError if it is not taken."""
        from .youtube import sanitize_filename
        if self.jobs is None:
            raise ValueError("This server does not take files.")
        name = sanitize_filename(Path(filename.replace("\\", "/")).name)
        if Path(name).suffix.lower() not in UPLOAD_TYPES:
            raise ValueError(f"{name} is not an audio file this app reads.")
        if not 0 < length <= MAX_UPLOAD:
            raise ValueError("The file is empty or larger than 2 GB.")
        return name

    def add_upload(self, owner: str, filename: str, length: int, stream) -> int:
        """Store a file sent by another PC and add it to that PC's list. Returns the song id."""
        name = self.check_upload(filename, length)
        folder = self.jobs / owner / "uploads" / secrets.token_hex(8)
        folder.mkdir(parents=True)
        target = folder / name
        try:
            with open(target, "wb") as f:
                remaining = length
                while remaining > 0:
                    chunk = stream.read(min(1 << 20, remaining))
                    if not chunk:
                        raise ValueError("The upload was interrupted.")
                    f.write(chunk)
                    remaining -= len(chunk)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        with self.lock:
            song = Song(self.next_id, str(target), target.stem, owner=owner, upload=target)
            self.songs.append(song)
            self.next_id += 1
            return song.id

    def rename(self, song_id, name, owner: str | None = None) -> None:
        """Rename a song. Before separation this is the name its files are written under;
        after it, the files that were written are renamed."""
        from .pipeline import rename_result
        from .youtube import sanitize_filename
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Type a name for the song.")
        with self.lock:
            song = self._find(song_id, owner)
            if song is None:
                return
            if song.status in ("waiting", "queued"):
                song.name = song.title = sanitize_filename(name)
            elif song.status == "done" and song.result is not None:
                rename_result(song.result, name)
                song.name = song.title = song.result.song
            elif song.status == "running":
                raise ValueError("Wait until the song is separated, then rename it.")
            else:
                raise ValueError("A song that could not be separated cannot be renamed.")

    def start(self, data: dict, owner: str | None = None) -> None:
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
                    "out_dir": Path(str(data.get("output") or self.default_output)),
                    "auto_title": data.get("autoTitle", True) is not False,
                    "keep_original": data.get("keepOriginal", True) is not False}
        with self.lock:
            waiting = [song for song in self.songs if song.owner == owner and song.status == "waiting"]
            if not waiting:
                raise ValueError("Add a song first.")
            for song in waiting:
                song.settings = dict(settings)
                if owner is not None:  # never a folder named by another PC
                    song.settings["out_dir"] = self._job_folder(song)
                song.status = "queued"
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
                settings, name = song.settings, song.name
                self.cancel.clear()
            if song.owner is not None:
                self.on_event(song.owner, f"separating {song.title}")

            def report(message, fraction, song=song):
                with self.lock:
                    if not self.cancel.is_set():
                        song.message, song.progress = message, fraction

            def on_song(title, song=song):
                with self.lock:
                    song.title = title

            try:
                result = run(song.source, report=report, cancel=self.cancel, on_song=on_song,
                             name=name, **settings)
                with self.lock:
                    song.status, song.result, song.progress = "done", result, 1.0
                    song.message = f"Done in {result.seconds:.0f} s · {len(result.stems)} stems"
                    self._drop_upload(song)
                if song.owner is not None:
                    self.on_event(song.owner, f"{song.title} done in {result.seconds:.0f} s")
            except Cancelled:
                with self.lock:
                    song.status, song.settings = "waiting", None
                    song.message, song.progress = "Cancelled", 0.0
            except Exception as e:
                with self.lock:
                    song.status, song.progress = "failed", 0.0
                    song.error = str(e) or type(e).__name__
                    song.message = "Failed"
                    self._drop_upload(song)
                if song.owner is not None:
                    self.on_event(song.owner, f"{song.title} failed: {song.error}")

    def _drop_upload(self, song: Song) -> None:
        """The uploaded copy is not needed once the song is separated (the sender has the file)."""
        if song.upload is not None:
            shutil.rmtree(song.upload.parent, ignore_errors=True)
            song.upload = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 300  # an idle or stalled connection is dropped
    unread = 0  # bytes of the request body not read yet (None: unknown)

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

    def owner(self, query: dict):
        """The caller's owner id (None for this PC's window), or DENIED."""
        given = self.headers.get("X-Session-Token") or (query.get("token") or [""])[0]
        return self.server.authenticate(given, self)

    def send_file(self, path: Path, content_type: str, download: bool = False):
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
        if download:
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(path.name)}")
        self.end_headers()
        position, remaining = start, end - start + 1
        try:
            while remaining > 0:
                # The file is only held open while reading, never while the player is slow to take
                # the data, so that a finished song can still be renamed while it is loaded.
                with open(path, "rb") as f:
                    f.seek(position)
                    chunk = f.read(min(262144, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                position += len(chunk)
                remaining -= len(chunk)
        except (ConnectionError, OSError):
            pass  # the player dropped the connection, e.g. on seek, or the file was renamed

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        if url.path.startswith("/api/"):
            if self.server.public_route(self, "GET", url.path, query):
                return
            owner = self.owner(query)
            if owner is DENIED:
                return self.respond(403, {"error": "Invalid session."})
            workspace = self.server.workspace
            song_id = (query.get("id") or [""])[0]
            if url.path == "/api/state":
                return self.respond(200, workspace.state(owner))
            if url.path == "/api/result":
                result = workspace.result(song_id, owner)
                if result is None:
                    return self.respond(404, {"error": "That song has no result."})
                return self.respond(200, result)
            if url.path == "/api/audio":
                path = workspace.stem_path(song_id, (query.get("stem") or [""])[0], owner)
                if path is None or not path.is_file():
                    return self.respond(404, {"error": "That stem is not available."})
                return self.send_file(path, "audio/mpeg")
            if url.path == "/api/file":
                path = workspace.file_path(song_id, (query.get("name") or [""])[0], owner)
                if path is None or not path.is_file():
                    return self.respond(404, {"error": "That file is not available."})
                return self.send_file(path, "audio/mpeg", download=True)
            return self.respond(404, {"error": "Not found."})
        name = "index.html" if url.path == "/" else url.path.lstrip("/")
        target = (WEB / name).resolve()
        if WEB.resolve() not in target.parents or not target.is_file():
            return self.respond(404, {"error": "Not found."})
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            kind = "text/javascript"
        self.respond(200, target.read_bytes(), kind + ("; charset=utf-8" if kind.startswith("text/") else ""))

    def read_body(self, limit: int = 1 << 20) -> bytes:
        if self.unread > limit:
            raise ValueError("The request is too large.")
        data, self.unread = self.rfile.read(self.unread), 0
        return data

    def refuse(self, status: int, message: str):
        """Answer with an error. What is left of the request body is read first, so that the
        connection can carry the next request; a large or unknown rest closes it instead."""
        if self.unread is None or self.unread > 1 << 20:
            self.close_connection = True
        elif self.unread:
            try:
                self.read_body()
            except (OSError, ValueError):
                self.close_connection = True
        self.respond(status, {"error": message})

    def do_POST(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        try:
            self.unread = int(self.headers.get("Content-Length") or 0)
            if self.unread < 0:
                raise ValueError("Bad Content-Length.")
        except ValueError:
            self.unread = None
            return self.refuse(400, "Bad Content-Length.")
        try:
            if self.server.public_route(self, "POST", url.path, query):
                return
            owner = self.owner(query)
            if owner is DENIED:
                return self.refuse(403, "Invalid session.")
            if url.path == "/api/upload":
                if owner is None:
                    raise ValueError("Add files on this PC by their path.")
                name, length = (query.get("name") or [""])[0], self.unread
                workspace = self.server.workspace
                workspace.check_upload(name, length)
                self.unread = None  # if reading fails part way, the rest is unknown
                song_id = workspace.add_upload(owner, name, length, self.rfile)
                self.unread = 0
                workspace.on_event(owner, f"received {name}")
                return self.respond(200, {"id": song_id, **workspace.state(owner)})
            if url.path != "/api/command":
                return self.refuse(404, "Not found.")
            data = json.loads(self.read_body() or b"{}")
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            self.respond(200, self.server.workspace.command(str(data.get("action")), data, owner))
        except (ValueError, OSError) as e:
            self.refuse(400, str(e))


class LocalServer(ThreadingHTTPServer):
    """The server of this PC's own window: one session token, full access."""
    daemon_threads = True

    def authenticate(self, given: str, handler) -> object:
        return None if secrets.compare_digest(given, self.token) else DENIED

    def public_route(self, handler, method: str, path: str, query: dict) -> bool:
        return False


def make_server(host: str = "127.0.0.1", port: int = 0, token: str | None = None,
                output: Path | None = None) -> ThreadingHTTPServer:
    server = LocalServer((host, port), Handler)
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
