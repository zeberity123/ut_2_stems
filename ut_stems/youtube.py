"""Download the audio of a YouTube video as an MP3.

The yt-dlp settings follow zeberity123/ut_downloader's audio-only path.
"""

from __future__ import annotations

import os
import re
import shutil
import threading
from pathlib import Path
from typing import Callable

from . import Cancelled
from .audio import ffmpeg_dir, transcode_mp3

# Highest-bitrate audio stream first (usually Opus 160 kbps), then AAC itag 140, then
# a combined stream for videos that publish no audio-only stream.
AUDIO_FORMAT = "bestaudio/140/best"

# yt-dlp pools the formats of every listed client; `android` stays last because it is
# the most degraded. See ut_downloader/downloader.py for the history.
_PLAYER_CLIENTS = ["default", "tv", "mweb", "web_embedded", "android"]
# Tried one at a time when YouTube answers 403 for the pooled extraction.
_RETRY_CLIENTS = ("visionos", "android_vr", "tv", "web_safari", "mweb", "android")


def is_url(text: str) -> bool:
    return bool(re.match(r"https?://", text.strip(), re.IGNORECASE))


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip().rstrip(".")
    return name[:180] or "audio"


class _Quiet:
    def debug(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def download_mp3(url: str, dest_dir: Path, progress: Callable[[float], None] = lambda f: None,
                 cancel: threading.Event | None = None, bitrate: str = "320k") -> tuple[Path, str]:
    """Download one video's audio and save it as ``<dest_dir>/<title>.mp3``.

    Returns the MP3 path and the video title. Playlist parameters in the link are
    ignored; only the linked video is downloaded.
    """
    import yt_dlp

    dest_dir.mkdir(parents=True, exist_ok=True)

    def hook(data):
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        if data.get("status") == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            if total:
                progress(data.get("downloaded_bytes", 0) / total)

    opts = {
        "quiet": True, "no_warnings": True, "logger": _Quiet(),
        "noplaylist": True,
        "format": AUDIO_FORMAT,
        "format_sort": ["proto"],
        "outtmpl": str(dest_dir / f"_tmp_audio_{os.getpid()}.%(ext)s"),
        "overwrites": True, "continuedl": False,
        "progress_hooks": [hook],
        "extractor_args": {"youtube": {"player_client": list(_PLAYER_CLIENTS)}},
        "ffmpeg_location": ffmpeg_dir(),
        "socket_timeout": 20, "retries": 2, "fragment_retries": 2,
    }
    # YouTube needs a JavaScript runtime to solve its player challenges.
    runtimes = {name: {} for name in ("deno", "node") if shutil.which(name)}
    if runtimes:
        opts["js_runtimes"] = runtimes

    def run(options):
        with yt_dlp.YoutubeDL(options) as ydl:
            return ydl.extract_info(url, download=True)

    try:
        info = run(opts)
    except yt_dlp.utils.DownloadError as first_error:
        info = None
        if "403" in str(first_error):
            # A 403 is tied to one client's media URLs; re-extract with single clients.
            for client in _RETRY_CLIENTS:
                retry = dict(opts, extractor_args={"youtube": {"player_client": [client]}})
                try:
                    info = run(retry)
                    break
                except yt_dlp.utils.DownloadError:
                    continue
        if info is None:
            detail = re.sub(r"^ERROR:\s*", "", str(first_error))
            raise RuntimeError(f"YouTube download failed: {detail}") from first_error

    downloads = (info or {}).get("requested_downloads") or []
    source = next((Path(d["filepath"]) for d in downloads
                   if d.get("filepath") and Path(d["filepath"]).is_file()), None)
    if source is None:
        raise RuntimeError("The YouTube download did not produce an audio file.")

    title = info.get("title") or info.get("id") or "audio"
    target = dest_dir / f"{sanitize_filename(title)}.mp3"
    try:
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        transcode_mp3(source, target, bitrate)
    finally:
        source.unlink(missing_ok=True)
    return target, title
