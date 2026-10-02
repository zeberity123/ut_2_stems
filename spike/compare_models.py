"""Phase 2 spike: run BS-RoFormer SW and htdemucs_6s on one MP3 and compare them.

Usage: python spike/compare_models.py path/to/song.mp3 [--out output/spike]

Writes <out>/<model>/<songname>_<instrument>.mp3 (320 kbps) for both models and
<out>/report.json with run time, peak VRAM and a few numeric comparisons.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch

SR = 44100
STEMS = ["vocals", "bass", "drums", "guitars", "piano", "others"]
# model-native stem names -> our names
RENAME = {"guitar": "guitars", "other": "others"}


def decode(path: Path) -> np.ndarray:
    """Decode any audio file to float32 stereo 44.1 kHz, shape (2, samples)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
           "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()


def encode_mp3(audio: np.ndarray, path: Path) -> None:
    """Write (2, samples) float32 audio as a 320 kbps MP3."""
    pcm = np.clip(audio, -1.0, 1.0).T.astype(np.float32).tobytes()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR),
           "-i", "-", "-c:a", "libmp3lame", "-b:a", "320k", str(path)]
    subprocess.run(cmd, input=pcm, check=True)


def run_bs_roformer_sw(mix: np.ndarray, device: torch.device) -> dict[str, np.ndarray]:
    import yaml
    from ml_collections import ConfigDict
    from bs_roformer import demix_track, ensure_model_assets, get_model_from_config

    ckpt, cfg_path = ensure_model_assets()
    with open(cfg_path) as f:
        config = ConfigDict(yaml.safe_load(f))
    model = get_model_from_config("bs_roformer", config)
    model.load_state_dict(torch.load(ckpt, map_location="cpu"))
    model = model.to(device).eval()
    res, _ = demix_track(config, model, torch.from_numpy(mix), device)
    del model
    return {RENAME.get(k, k): v for k, v in res.items()}


def run_htdemucs_6s(mix: np.ndarray, device: torch.device) -> dict[str, np.ndarray]:
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_6s")
    model.eval()
    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device,
                          shifts=1, split=True, overlap=0.25, progress=True)[0]
    out = (out * std + mean).cpu().numpy()
    names = list(model.sources)
    del model
    return {RENAME.get(k, k): out[i] for i, k in enumerate(names)}


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

    for name, fn in [("bs_roformer_sw", run_bs_roformer_sw), ("htdemucs_6s", run_htdemucs_6s)]:
        print(f"\n=== {name} ===")
        if device.type == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
        t0 = time.time()
        stems = fn(mix, device)
        elapsed = time.time() - t0
        peak = torch.cuda.max_memory_allocated() / 1024 ** 3 if device.type == "cuda" else 0.0
        missing = [s for s in STEMS if s not in stems]
        if missing:
            raise RuntimeError(f"{name} did not return stems: {missing}")

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
