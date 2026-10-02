"""Separation models. Each runner takes a (2, samples) mix and returns one array per stem."""

from __future__ import annotations

import warnings

import numpy as np
import torch

from . import STEMS

DEFAULT_MODEL = "bs_roformer_sw"
# model-native stem names -> our names
_RENAME = {"guitar": "guitars", "other": "others"}


def _bs_roformer_sw(mix: np.ndarray, device: torch.device, overlap: int) -> dict[str, np.ndarray]:
    import yaml
    from bs_roformer import demix_track, ensure_model_assets, get_model_from_config
    from ml_collections import ConfigDict

    # First use downloads the ~670 MB checkpoint to ~/.cache/bs-roformer-infer.
    ckpt, cfg_path = ensure_model_assets()
    with open(cfg_path) as f:
        config = ConfigDict(yaml.safe_load(f))
    config.inference.num_overlap = overlap

    # bs_roformer emits deprecation and STFT-probe warnings that do not affect the output.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", (FutureWarning, UserWarning))
        model = get_model_from_config("bs_roformer", config)
        model.load_state_dict(torch.load(ckpt, map_location="cpu"))
        model = model.to(device).eval()
        res, _ = demix_track(config, model, torch.from_numpy(mix), device)
    return res


def _htdemucs_6s(mix: np.ndarray, device: torch.device, overlap: int) -> dict[str, np.ndarray]:
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_6s")
    model.eval()
    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    # Demucs takes overlap as a fraction; factor 2 maps to its default of 0.25.
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1,
                          split=True, overlap=(overlap - 1) * 0.25, progress=True)[0]
    out = (out * std + mean).cpu().numpy()
    return dict(zip(model.sources, out))


MODELS = {"bs_roformer_sw": _bs_roformer_sw, "htdemucs_6s": _htdemucs_6s}


def separate(mix: np.ndarray, model: str = DEFAULT_MODEL, device: torch.device | None = None,
             overlap: int = 2) -> dict[str, np.ndarray]:
    """Split a (2, samples) 44.1 kHz mix into the six stems in ``ut_stems.STEMS``."""
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    raw = MODELS[model](mix, device, overlap)
    stems = {_RENAME.get(name, name): audio for name, audio in raw.items()}
    missing = [s for s in STEMS if s not in stems]
    if missing:
        raise RuntimeError(f"{model} did not return stems: {missing}")
    return {s: stems[s] for s in STEMS}
