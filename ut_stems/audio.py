"""Audio decode/encode through ffmpeg. Everything in between is float32 stereo 44.1 kHz."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np

SR = 44100


class AudioError(Exception):
    pass


def _ffmpeg() -> str:
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


def encode_mp3(audio: np.ndarray, path: Path, bitrate: str = "320k") -> None:
    """Write (2, samples) float32 audio as a constant-bitrate MP3."""
    pcm = np.clip(audio, -1.0, 1.0).T.astype(np.float32).tobytes()
    cmd = [_ffmpeg(), "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR),
           "-i", "-", "-c:a", "libmp3lame", "-b:a", bitrate, str(path)]
    proc = subprocess.run(cmd, input=pcm, capture_output=True)
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise AudioError(f"ffmpeg could not write {path.name}: {detail}")
