"""Audio decode/encode through ffmpeg. Everything in between is float32 stereo 44.1 kHz."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

from .paths import ROOT

SR = 44100


class AudioError(Exception):
    pass


def _ffmpeg() -> str:
    """``UT_STEMS_FFMPEG``, then the ffmpeg shipped next to the packaged app, then PATH."""
    chosen = os.environ.get("UT_STEMS_FFMPEG")
    if chosen and Path(chosen).is_file():
        return chosen
    bundled = ROOT / "ffmpeg.exe"
    if bundled.is_file():
        return str(bundled)
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise AudioError("ffmpeg was not found on PATH. Install it "
                         "(winget install Gyan.FFmpeg) and open a new terminal.")
    return exe


def ffmpeg_dir() -> str:
    return str(Path(_ffmpeg()).parent)


def transcode_mp3(source: Path, target: Path, bitrate: str = "320k") -> None:
    """Convert any audio/video file to an MP3, dropping video."""
    cmd = [_ffmpeg(), "-v", "error", "-y", "-i", str(source), "-vn",
           "-c:a", "libmp3lame", "-b:a", bitrate, str(target)]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise AudioError(f"ffmpeg could not convert {source.name}: {detail}")


def decode(path: Path) -> np.ndarray:
    """Decode an audio file to float32 stereo 44.1 kHz, shape (2, samples)."""
    cmd = [_ffmpeg(), "-v", "error", "-i", str(path), "-vn", "-f", "f32le",
           "-ac", "2", "-ar", str(SR), "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise AudioError(f"ffmpeg could not decode {path.name}: {detail}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, 2).T.copy()
    if audio.shape[1] == 0:
        raise AudioError(f"{path.name} contains no audio")
    return audio


LOSSLESS = {".wav", ".wave", ".flac", ".aif", ".aiff", ".aifc", ".ape", ".wv", ".tta"}
FORMATS = ("auto", "mp3", "wav")


def output_format(choice: str, source: Path | None, downloaded: bool) -> str:
    """``mp3`` or ``wav`` for the stems. ``auto`` keeps lossless files lossless: a WAV, FLAC or
    AIFF file gives WAV stems; a YouTube download or an MP3 gives MP3 stems."""
    if choice not in FORMATS:
        raise ValueError(f"Unknown format: {choice}")
    if choice != "auto":
        return choice
    if downloaded or source is None:
        return "mp3"
    return "wav" if source.suffix.lower() in LOSSLESS else "mp3"


def _encode(audio: np.ndarray, path: Path, codec: list[str]) -> None:
    pcm = np.clip(audio, -1.0, 1.0).T.astype(np.float32).tobytes()
    cmd = [_ffmpeg(), "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR),
           "-i", "-", *codec, str(path)]
    proc = subprocess.run(cmd, input=pcm, capture_output=True)
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise AudioError(f"ffmpeg could not write {path.name}: {detail}")


def encode_mp3(audio: np.ndarray, path: Path, bitrate: str = "320k") -> None:
    """Write (2, samples) float32 audio as a constant-bitrate MP3."""
    _encode(audio, path, ["-c:a", "libmp3lame", "-b:a", bitrate])


def encode_wav(audio: np.ndarray, path: Path) -> None:
    """Write (2, samples) float32 audio as a 24-bit PCM WAV."""
    _encode(audio, path, ["-c:a", "pcm_s24le"])


def encode(audio: np.ndarray, path: Path, bitrate: str = "320k") -> None:
    """Write the audio in the format the file name asks for (``.wav`` or ``.mp3``)."""
    if path.suffix.lower() == ".wav":
        encode_wav(audio, path)
    else:
        encode_mp3(audio, path, bitrate)
