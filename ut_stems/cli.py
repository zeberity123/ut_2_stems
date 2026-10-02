"""Command line: ut-stems song.mp3 [more songs]  ->  <out>/<songname>_<instrument>.mp3 per stem."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import DEFAULT_MODEL, MODEL_NAMES, STEMS, __version__
from .audio import AudioError


def _stem_list(text: str) -> list[str]:
    names = [name.strip().lower() for name in text.split(",") if name.strip()]
    unknown = [name for name in names if name not in STEMS]
    if unknown or not names:
        raise argparse.ArgumentTypeError(
            f"choose from {', '.join(STEMS)} (comma separated); got {text!r}")
    return names


def _parse(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="ut-stems",
        description="Split a song into MP3 stems: " + ", ".join(STEMS) + ".")
    ap.add_argument("inputs", nargs="+", metavar="input",
                    help="audio files (MP3 or anything ffmpeg reads) or YouTube links, separated in order")
    ap.add_argument("-o", "--out", type=Path, default=Path("output"),
                    help="folder for the stems (default: ./output)")
    ap.add_argument("--stems", type=_stem_list, default=list(STEMS), metavar="LIST",
                    help="comma-separated stems to write, e.g. vocals,bass,drums,guitars "
                         "(default: all six). 'others' collects everything not selected.")
    ap.add_argument("--model", choices=MODEL_NAMES, default=DEFAULT_MODEL,
                    help=f"separation model (default: {DEFAULT_MODEL})")
    ap.add_argument("--overlap", type=int, default=2, choices=[2, 3, 4],
                    help="chunk overlap factor; higher is slower and slightly smoother (default: 2)")
    ap.add_argument("--bitrate", default="320k", help="MP3 bitrate (default: 320k)")
    ap.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto",
                    help="where to run the model (default: auto)")
    ap.add_argument("--version", action="version", version=f"ut-stems {__version__}")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    # Song names are often non-ASCII; never crash on a console that cannot print them.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")
    args = _parse(argv)

    from .pipeline import run
    from .youtube import is_url

    missing = [source for source in args.inputs if not is_url(source) and not Path(source).is_file()]
    if missing:
        print("error: input file not found: " + ", ".join(missing), file=sys.stderr)
        return 2

    failed = 0
    for number, source in enumerate(args.inputs, 1):
        if len(args.inputs) > 1:
            print(f"[{number}/{len(args.inputs)}] {source}")
        last = ""

        def report(message: str, fraction: float) -> None:
            nonlocal last
            # Percentages change constantly; print each stage once.
            stage = message.split("…")[0]
            if stage != last:
                last = stage
                print(stage + "…", flush=True)

        try:
            result = run(source, args.out, stems=args.stems, model=args.model, overlap=args.overlap,
                         bitrate=args.bitrate, device=args.device, report=report)
        except (AudioError, RuntimeError, ValueError, OSError) as e:
            # One bad song does not stop the rest of the list.
            print(f"error: {e}", file=sys.stderr)
            failed += 1
            continue

        print(f"{result.song}: {result.duration:.1f} s, model={result.model}")
        for stem in result.stems:
            note = "  (silent)" if stem.level_db < -60 else ""
            print(f"  {stem.path}{note}")
        print(f"done in {result.seconds:.1f} s")
    return 1 if failed else 0
