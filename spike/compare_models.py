"""Phase 2 spike: run BS-RoFormer SW and htdemucs_6s on one MP3 and compare them.

Usage: python spike/compare_models.py path/to/song.mp3 [--out output/spike]

Writes <out>/<model>/<songname>_<instrument>.mp3 (320 kbps) for both models and
<out>/report.json with run time, peak VRAM and a few numeric comparisons.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from ut_stems import STEMS
from ut_stems.audio import SR, decode, encode_mp3
from ut_stems.models import MODELS, separate


def db(x: float) -> float:
    return float(10 * np.log10(max(x, 1e-12)))


def sdr(ref: np.ndarray, est: np.ndarray) -> float:
    return db(float(np.sum(ref ** 2)) / max(float(np.sum((ref - est) ** 2)), 1e-12))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("--out", type=Path, default=Path("output/spike"))
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    mix = decode(args.input)
    song = args.input.stem
    duration = mix.shape[1] / SR
    print(f"{song}: {duration:.1f} s, device={device}")

    report: dict = {"song": song, "duration_s": round(duration, 1), "device": str(device),
                    "models": {}}
    results: dict[str, dict[str, np.ndarray]] = {}
    mix_power = float(np.mean(mix ** 2))

    for name in MODELS:
        print(f"\n=== {name} ===")
        if device.type == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
        t0 = time.time()
        stems = separate(mix, model=name, device=device)
        elapsed = time.time() - t0
        peak = torch.cuda.max_memory_allocated() / 1024 ** 3 if device.type == "cuda" else 0.0

        out_dir = args.out / name
        out_dir.mkdir(parents=True, exist_ok=True)
        for s in STEMS:
            encode_mp3(stems[s], out_dir / f"{song}_{s}.mp3")

        total = sum(stems[s] for s in STEMS)
        report["models"][name] = {
            "seconds_incl_model_load": round(elapsed, 1),
            "realtime_factor": round(duration / elapsed, 1),
            "peak_vram_gb": round(peak, 2),
            "stems_sum_vs_mix_sdr_db": round(sdr(mix, total), 1),
            "stem_level_db_rel_mix": {
                s: round(db(float(np.mean(stems[s] ** 2)) / mix_power), 1) for s in STEMS},
        }
        results[name] = stems
        print(json.dumps(report["models"][name], indent=2))

    a, b = results["bs_roformer_sw"], results["htdemucs_6s"]
    # How closely the two models agree on each stem (higher = more similar output).
    report["agreement_sdr_db"] = {s: round(sdr(a[s], b[s]), 1) for s in STEMS}
    print("\nagreement between models (dB):", report["agreement_sdr_db"])

    (args.out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
    print(f"\nwrote {args.out / 'report.json'}")


if __name__ == "__main__":
    main()
