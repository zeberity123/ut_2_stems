"""The whole job: file or YouTube link in, ``<songname>_<instrument>.mp3`` files out."""

from __future__ import annotations

import os
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
    original: Path | None = None  # the downloaded song MP3, if it was kept


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
        name: str | None = None, auto_title: bool = True,
        keep_original: bool = True) -> Result:
    """Separate one song and write the selected stems as MP3 files into ``out_dir``.

    ``on_song`` is called with the song name as soon as it is known: for a YouTube
    link the video title when the download starts, and the final name after it.
    ``name`` replaces the file name or video title as the song name in the files
    that are written. Without a name, ``auto_title=False`` names a YouTube song
    after its video id instead of its title. ``keep_original=False`` deletes the
    downloaded song MP3 once the stems are written; a local file is never deleted.
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

    started = time.time()
    downloaded = is_url(source)
    if downloaded:
        report("Downloading audio from YouTube…", 0.0)
        announce = on_song if on_song is not None and auto_title and not name else None
        path, _title = download_mp3(
            source, out_dir, cancel=cancel, bitrate=bitrate, name=name, use_title=auto_title,
            on_title=(lambda title: announce(sanitize_filename(title))) if announce else None,
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
    try:
        files, duration = _separate(path, song, out_dir, wanted, model, overlap, bitrate,
                                    device, report, cancel, base)
    except BaseException:
        if downloaded and not keep_original:
            path.unlink(missing_ok=True)
        raise
    original = path if downloaded else None
    if original is not None and not keep_original:
        original.unlink(missing_ok=True)
        original = None
    return Result(song=song, source=path, folder=out_dir, duration=duration,
                  seconds=time.time() - started, model=model, stems=files, original=original)


def _separate(path: Path, song: str, out_dir: Path, wanted: list[str], model: str, overlap: int,
              bitrate: str, device: str, report: Report, cancel: threading.Event | None,
              base: float) -> tuple[list[StemFile], float]:
    def check():
        if cancel is not None and cancel.is_set():
            raise Cancelled()

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
    return files, duration


def _move(source: Path, target: Path) -> None:
    """Rename one file, waiting briefly for a player or virus scanner to let go of it."""
    for attempt in range(6):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.15)


def rename_result(result: Result, name: str) -> None:
    """Rename the files of a finished song to ``<name>_<instrument>.mp3`` (and ``<name>.mp3``).

    Either every file is renamed or, if one cannot be, none are.
    """
    song = sanitize_filename(name)
    moves = [(stem.path, stem.path.with_name(f"{song}_{stem.name}.mp3")) for stem in result.stems]
    # The downloaded song MP3 is renamed along, unless it has been deleted meanwhile.
    original = result.original if result.original is not None and result.original.is_file() else None
    if original is not None:
        moves.append((original, original.with_name(f"{song}.mp3")))
    moves = [(old, new) for old, new in moves if old.name != new.name]  # Path == ignores case on Windows
    for old, new in moves:
        if not old.is_file():
            raise FileNotFoundError(f"{old.name} is no longer in {old.parent}.")
        # A different file already has that name. A change of case only is the same file on Windows.
        if new.exists() and not os.path.samefile(old, new):
            raise FileExistsError(f"{new.name} already exists in {new.parent}.")
    done = []
    try:
        for old, new in moves:
            _move(old, new)
            done.append((old, new))
    except OSError as e:
        failed = old.name
        for back, forth in reversed(done):
            try:
                os.replace(forth, back)
            except OSError:
                pass
        raise OSError(f"Could not rename {failed}: {e.strerror or e}") from e
    for stem in result.stems:
        stem.path = stem.path.with_name(f"{song}_{stem.name}.mp3")
    result.original = original.with_name(f"{song}.mp3") if original is not None else None
    result.song = song
