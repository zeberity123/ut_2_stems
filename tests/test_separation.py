"""End-to-end separation on a short clip. Needs a CUDA GPU and the model checkpoint
(downloaded on first use), so these are marked slow: run with ``pytest -m slow``."""

import numpy as np
import pytest

from ut_stems import STEMS
from ut_stems.audio import SR, decode, encode_mp3
from ut_stems.pipeline import run

torch = pytest.importorskip("torch")
pytestmark = [pytest.mark.slow,
              pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a CUDA GPU")]


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    """Eight seconds of a low tone, a chord and noise bursts: not music, but not silence."""
    t = np.arange(SR * 8) / SR
    rng = np.random.default_rng(0)
    low = 0.25 * np.sin(2 * np.pi * 55 * t)
    chord = 0.1 * sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.2, 329.6))
    bursts = 0.2 * rng.standard_normal(len(t)) * (np.sin(2 * np.pi * 2 * t) > 0.95)
    mono = (low + chord + bursts).astype(np.float32)
    path = tmp_path_factory.mktemp("clip") / "test clip.mp3"
    encode_mp3(np.stack([mono, mono]), path)
    return path


def sdr(reference, estimate):
    return 10 * np.log10(np.sum(reference ** 2) / max(np.sum((reference - estimate) ** 2), 1e-12))


def test_all_stems_are_written_and_add_up_to_the_song(clip, tmp_path):
    messages = []
    result = run(str(clip), tmp_path, report=lambda message, fraction: messages.append((message, fraction)))

    assert [stem.name for stem in result.stems] == STEMS
    assert [stem.path.name for stem in result.stems] == [f"test clip_{name}.mp3" for name in STEMS]
    assert all(len(stem.peaks) == 800 and max(stem.peaks) <= 1 for stem in result.stems)
    fractions = [fraction for _, fraction in messages]
    assert fractions == sorted(fractions) and 0 <= fractions[0] and fractions[-1] <= 1
    assert any(message.startswith("Separating stems") for message, _ in messages)

    mix = decode(clip)
    stems = [decode(stem.path) for stem in result.stems]
    assert all(stem.shape == mix.shape for stem in stems)
    assert sdr(mix, sum(stems)) > 15


def test_selected_stems_only(clip, tmp_path):
    result = run(str(clip), tmp_path, stems=["vocals", "bass", "drums", "guitars"])
    assert [stem.name for stem in result.stems] == ["vocals", "bass", "drums", "guitars"]
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(
        f"test clip_{name}.mp3" for name in ["vocals", "bass", "drums", "guitars"])


def test_name_replaces_the_song_name_in_the_files(clip, tmp_path):
    result = run(str(clip), tmp_path, stems=["vocals"], name="Renamed: song")
    assert result.song == "Renamed_ song"
    assert [path.name for path in tmp_path.iterdir()] == ["Renamed_ song_vocals.mp3"]


def test_others_collects_what_was_not_selected(clip, tmp_path):
    result = run(str(clip), tmp_path, stems=["bass", "others"])
    mix = decode(clip)
    total = sum(decode(stem.path) for stem in result.stems)
    assert sdr(mix, total) > 15  # bass + others is still the whole song


def test_cancel_during_separation_writes_nothing(clip, tmp_path):
    import threading
    from ut_stems import Cancelled

    cancel = threading.Event()

    def report(message, fraction):
        if message.startswith("Separating"):
            cancel.set()

    with pytest.raises(Cancelled):
        run(str(clip), tmp_path, report=report, cancel=cancel)
    assert not list(tmp_path.iterdir())
