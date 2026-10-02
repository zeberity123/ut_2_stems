"""The whole job: file or YouTube link in, ``<songname>_<instrument>.mp3`` files out."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from . import DEFAULT_MODEL, MODEL_NAMES, STEMS, Cancelled
from .audio import SR, decode, encode_mp3
from .youtube import download_mp3, is_url, sanitize_filename

Report = Callable[[str, float], None]
PEAK_BINS = 800


@dataclass
class StemFile:
    name: str
    path: Path
    level_db: float  # loudness relative to the full song; about -60 or lower is silence
    peaks: list[float] = field(repr=False)  # waveform outline, 0..1, scaled to the song's peak


@dataclass
class Result:
    song: str
    source: Path
    folder: Path
    duration: float
    seconds: float
    model: str
    stems: list[StemFile]


def _peaks(audio: np.ndarray, scale: float) -> list[float]:
    mono = np.abs(audio).max(axis=0)
    usable = len(mono) - len(mono) % PEAK_BINS
    if usable == 0:
        return [0.0] * PEAK_BINS
    bins = mono[:usable].reshape(PEAK_BINS, -1).max(axis=1) / scale
    return [round(float(v), 3) for v in np.clip(bins, 0, 1)]


def run(source: str, out_dir: Path, stems: list[str] | None = None, model: str = DEFAULT_MODEL,
        overlap: int = 2, bitrate: str = "320k", device: str = "auto",
        report: Report = lambda message, fraction: None,
        cancel: threading.Event | None = None,
        on_song: Callable[[str], None] | None = None,
        name: str | None = None) -> Result:
    """Separate one song and write the selected stems as MP3 files into ``out_dir``.

    ``on_song`` is called with the song name as soon as it is known, which for a
    YouTube link is after the download. ``name`` replaces the file name or video
    title as the song name in the files that are written.
    """
    if stems is None:
        stems = list(STEMS)
    if set(stems) - set(STEMS):
        raise ValueError(f"Unknown stems: {sorted(set(stems) - set(STEMS))}")
    wanted = [s for s in STEMS if s in stems]
    if not wanted:
        raise ValueError("Select at least one stem.")
    if model not in MODEL_NAMES:
        raise ValueError(f"Unknown model: {model}")
    source = source.strip().strip('"')
    if not source:
        raise ValueError("Paste a YouTube link or choose an audio file.")
    out_dir = Path(out_dir).expanduser().resolve()

    def check():
        if cancel is not None and cancel.is_set():
            raise Cancelled()

    started = time.time()
    if is_url(source):
        report("Downloading audio from YouTube…", 0.0)
        path, _title = download_mp3(source, out_dir, cancel=cancel, bitrate=bitrate, name=name,
                                    progress=lambda f: report(f"Downloading audio from YouTube… {f:.0%}", 0.12 * f))
        base = 0.15
    else:
        path = Path(source).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        base = 0.0
    song = sanitize_filename(name) if name else path.stem
    if on_song is not None:
        on_song(song)

    check()
    report("Reading audio…", base)
    mix = decode(path)
    duration = mix.shape[1] / SR

    check()
    report("Loading the separation model…", base + 0.03)
    # Imported here so that everything above works without loading torch.
    from .models import pick_device, select_stems, separate
    torch_device = pick_device(device)

    span = 0.9 - (base + 0.05)
    separated = separate(
        mix, model=model, device=torch_device, overlap=overlap, cancel=cancel,
        progress=lambda f: report(f"Separating stems… {f:.0%}", base + 0.05 + span * f))
    kept = select_stems(separated, wanted)

    out_dir.mkdir(parents=True, exist_ok=True)
    mix_power = max(float(np.mean(mix ** 2)), 1e-12)
    mix_peak = max(float(np.abs(mix).max()), 1e-6)
    files = []
    for index, (name, audio) in enumerate(kept.items()):
        check()
        report(f"Writing {name}…", 0.9 + 0.1 * index / len(kept))
        target = out_dir / f"{song}_{name}.mp3"
        encode_mp3(audio, target, bitrate=bitrate)
        level = 10 * np.log10(max(float(np.mean(audio ** 2)), 1e-12) / mix_power)
        files.append(StemFile(name, target, round(float(level), 1), _peaks(audio, mix_peak)))

    return Result(song=song, source=path, folder=out_dir, duration=duration,
                  seconds=time.time() - started, model=model, stems=files)
