"""Command line: ut-stems song.mp3  ->  <out>/<songname>_<instrument>.mp3 for six stems."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import STEMS, __version__
from .audio import SR, AudioError, decode, encode_mp3
from .models import DEFAULT_MODEL, MODELS


def _parse(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="ut-stems",
        description="Split a song into six MP3 stems: " + ", ".join(STEMS) + ".")
    ap.add_argument("input", type=Path, help="audio file to separate (MP3 or anything ffmpeg reads)")
    ap.add_argument("-o", "--out", type=Path, default=Path("output"),
                    help="folder for the stems (default: ./output)")
    ap.add_argument("--model", choices=list(MODELS), default=DEFAULT_MODEL,
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

    if not args.input.is_file():
        print(f"error: input file not found: {args.input}", file=sys.stderr)
        return 2

    try:
        mix = decode(args.input)
    except AudioError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    # Imported late so --help and input errors do not pay for loading torch.
    import torch
    from .models import separate

    if args.device == "cuda" and not torch.cuda.is_available():
        print("error: --device cuda requested but CUDA is not available", file=sys.stderr)
        return 1
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if device.type == "cpu":
            print("CUDA is not available, running on CPU. This will be slow.")
    else:
        device = torch.device(args.device)

    song = args.input.stem
    print(f"{song}: {mix.shape[1] / SR:.1f} s, model={args.model}, device={device}")
    start = time.time()
    stems = separate(mix, model=args.model, device=device, overlap=args.overlap)

    args.out.mkdir(parents=True, exist_ok=True)
    try:
        for name in STEMS:
            path = args.out / f"{song}_{name}.mp3"
            encode_mp3(stems[name], path, bitrate=args.bitrate)
            print(f"  {path}")
    except AudioError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"done in {time.time() - start:.1f} s")
    return 0
