"""Separation models. Each runner takes a (2, samples) mix and returns one array per stem."""

from __future__ import annotations

import threading
import warnings
from typing import Callable

import numpy as np
import torch

from . import DEFAULT_MODEL, STEMS, Cancelled

# model-native stem names -> our names
_RENAME = {"guitar": "guitars", "other": "others"}

Progress = Callable[[float], None]


def _check(cancel: threading.Event | None) -> None:
    if cancel is not None and cancel.is_set():
        raise Cancelled()


# The loaded BS-RoFormer model, kept between runs so a second song starts immediately.
_sw_cache: dict[str, tuple] = {}


def _load_bs_roformer_sw(device: torch.device):
    key = str(device)
    if key not in _sw_cache:
        import yaml
        from bs_roformer import ensure_model_assets, get_model_from_config
        from ml_collections import ConfigDict

        # First use downloads the ~670 MB checkpoint to ~/.cache/bs-roformer-infer.
        ckpt, cfg_path = ensure_model_assets()
        with open(cfg_path) as f:
            config = ConfigDict(yaml.safe_load(f))
        # Building the model probes an STFT without a window, which only triggers a warning.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            model = get_model_from_config("bs_roformer", config)
        model.load_state_dict(torch.load(ckpt, map_location="cpu"))
        _sw_cache.clear()
        _sw_cache[key] = (model.to(device).eval(), config)
    return _sw_cache[key]


def _bs_roformer_sw(mix: np.ndarray, device: torch.device, overlap: int,
                    progress: Progress, cancel: threading.Event | None) -> dict[str, np.ndarray]:
    """Chunked overlap-add inference, same scheme as bs_roformer.demix_track."""
    model, config = _load_bs_roformer_sw(device)
    _check(cancel)
    names = list(config.training.instruments)
    chunk = int(config.inference.chunk_size)
    step = chunk // overlap
    fade = chunk // 10
    border = chunk - step

    audio = torch.from_numpy(mix)
    padded = audio.shape[1] > 2 * border and border > 0
    if padded:
        audio = torch.nn.functional.pad(audio, (border, border), mode="reflect")
    audio = audio.to(device)
    total = audio.shape[1]

    window = torch.ones(chunk, device=device)
    window[:fade] = torch.linspace(0, 1, fade, device=device)
    window[-fade:] = torch.linspace(1, 0, fade, device=device)

    result = torch.zeros((len(names), *audio.shape), dtype=torch.float32, device=device)
    weight = torch.zeros_like(result)
    with torch.no_grad(), torch.autocast(device.type, enabled=device.type == "cuda"):
        start = 0
        while start < total:
            _check(cancel)
            part = audio[:, start:start + chunk]
            length = part.shape[-1]
            if length < chunk:
                mode = "reflect" if length > chunk // 2 + 1 else "constant"
                part = torch.nn.functional.pad(part, (0, chunk - length), mode=mode)
            out = model(part.unsqueeze(0))[0]

            w = window.clone()
            if start == 0:
                w[:fade] = 1
            elif start + chunk >= total:
                w[-fade:] = 1
            result[..., start:start + length] += out[..., :length] * w[:length]
            weight[..., start:start + length] += w[:length]
            start += step
            progress(min(start, total) / total)

    stems = (result / weight).cpu().numpy()
    np.nan_to_num(stems, copy=False, nan=0.0)
    if padded:
        stems = stems[..., border:-border]
    return dict(zip(names, stems))


def _htdemucs_6s(mix: np.ndarray, device: torch.device, overlap: int,
                 progress: Progress, cancel: threading.Event | None) -> dict[str, np.ndarray]:
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_6s")
    model.eval()
    _check(cancel)
    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    # Demucs takes overlap as a fraction; factor 2 maps to its default of 0.25.
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1,
                          split=True, overlap=(overlap - 1) * 0.25, progress=False)[0]
    out = (out * std + mean).cpu().numpy()
    return dict(zip(model.sources, out))


MODELS = {"bs_roformer_sw": _bs_roformer_sw, "htdemucs_6s": _htdemucs_6s}


def pick_device(name: str = "auto") -> torch.device:
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if name == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available.")
    return torch.device(name)


def separate(mix: np.ndarray, model: str = DEFAULT_MODEL, device: torch.device | None = None,
             overlap: int = 2, progress: Progress | None = None,
             cancel: threading.Event | None = None) -> dict[str, np.ndarray]:
    """Split a (2, samples) 44.1 kHz mix into the six stems in ``ut_stems.STEMS``."""
    if device is None:
        device = pick_device()
    raw = MODELS[model](mix, device, overlap, progress or (lambda fraction: None), cancel)
    stems = {_RENAME.get(name, name): audio for name, audio in raw.items()}
    missing = [s for s in STEMS if s not in stems]
    if missing:
        raise RuntimeError(f"{model} did not return stems: {missing}")
    return {s: stems[s] for s in STEMS}


def select_stems(stems: dict[str, np.ndarray], wanted: list[str]) -> dict[str, np.ndarray]:
    """Keep only the wanted stems.

    When ``others`` is wanted it absorbs every stem that was left out, so the kept
    stems still add up to the whole song.
    """
    kept = {s: stems[s] for s in STEMS if s in wanted}
    if "others" in kept:
        dropped = [stems[s] for s in STEMS if s not in wanted]
        if dropped:
            kept["others"] = stems["others"] + sum(dropped)
    return kept
