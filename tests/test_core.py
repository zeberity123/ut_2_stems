"""Fast tests: audio I/O, stem selection, input handling. No model is loaded."""

import threading

import numpy as np
import pytest

from ut_stems import STEMS, Cancelled
from ut_stems.audio import SR, AudioError, decode, encode_mp3
from ut_stems.cli import main as cli_main
from ut_stems.pipeline import run
from ut_stems.youtube import is_url, sanitize_filename


def tone(seconds=1.0, frequency=440.0):
    t = np.arange(int(SR * seconds)) / SR
    wave = (0.5 * np.sin(2 * np.pi * frequency * t)).astype(np.float32)
    return np.stack([wave, wave])


def test_mp3_round_trip(tmp_path):
    original = tone(2.0)
    path = tmp_path / "だから_tone.mp3"  # non-ASCII names must survive the ffmpeg call
    encode_mp3(original, path)
    decoded = decode(path)
    assert decoded.shape[0] == 2
    assert abs(decoded.shape[1] - original.shape[1]) < SR * 0.1
    n = min(decoded.shape[1], original.shape[1])
    correlation = np.corrcoef(decoded[0, :n], original[0, :n])[0, 1]
    assert correlation > 0.99


def test_decode_rejects_non_audio(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("not audio")
    with pytest.raises(AudioError):
        decode(path)


def fake_stems():
    return {name: np.full((2, 4), float(i + 1), dtype=np.float32) for i, name in enumerate(STEMS)}


def test_select_all_keeps_every_stem_unchanged():
    from ut_stems.models import select_stems
    stems = fake_stems()
    kept = select_stems(stems, list(STEMS))
    assert list(kept) == STEMS
    assert all(np.array_equal(kept[name], stems[name]) for name in STEMS)


def test_select_subset_without_others_drops_the_rest():
    from ut_stems.models import select_stems
    kept = select_stems(fake_stems(), ["guitars", "vocals"])
    assert list(kept) == ["vocals", "guitars"]  # always in the standard order


def test_others_absorbs_unselected_stems():
    from ut_stems.models import select_stems
    stems = fake_stems()
    kept = select_stems(stems, ["vocals", "bass", "drums", "guitars", "others"])
    assert "piano" not in kept
    assert np.array_equal(kept["others"], stems["others"] + stems["piano"])
    # the kept stems still add up to the whole song
    assert np.array_equal(sum(kept.values()), sum(stems.values()))


def test_is_url():
    assert is_url("https://youtu.be/CkvWJNt77mU")
    assert is_url("  HTTP://example.com/a ")
    assert not is_url(r"C:\music\song.mp3")
    assert not is_url("song.mp3")


def test_sanitize_filename():
    assert sanitize_filename('AC/DC: "Back" in <Black>?') == "AC_DC_ _Back_ in _Black_"
    assert sanitize_filename("  spaced   out.  ") == "spaced out"
    assert sanitize_filename("???") == "_"
    assert sanitize_filename("") == "audio"


def test_run_rejects_bad_input(tmp_path):
    with pytest.raises(ValueError):
        run("song.mp3", tmp_path, stems=[])
    with pytest.raises(ValueError):
        run("song.mp3", tmp_path, stems=["kazoo"])
    with pytest.raises(ValueError):
        run("   ", tmp_path)
    with pytest.raises(FileNotFoundError):
        run(str(tmp_path / "missing.mp3"), tmp_path)


def test_run_stops_when_cancelled(tmp_path):
    source = tmp_path / "tone.mp3"
    encode_mp3(tone(), source)
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(Cancelled):
        run(str(source), tmp_path / "out", cancel=cancel)
    assert not (tmp_path / "out").exists()


def test_cli_reports_missing_file(capsys):
    assert cli_main(["definitely_missing.mp3"]) == 2
    assert "not found" in capsys.readouterr().err


def test_cli_continues_after_a_bad_song(tmp_path, capsys):
    bad = tmp_path / "bad.mp3"
    bad.write_text("not audio")
    worse = tmp_path / "worse.mp3"
    worse.write_text("not audio either")
    assert cli_main([str(bad), str(worse), "-o", str(tmp_path / "out")]) == 1
    captured = capsys.readouterr()
    assert "[1/2]" in captured.out and "[2/2]" in captured.out
    assert captured.err.count("could not decode") == 2


def test_cli_rejects_unknown_stem():
    with pytest.raises(SystemExit) as error:
        cli_main(["song.mp3", "--stems", "vocals,kazoo"])
    assert error.value.code == 2
