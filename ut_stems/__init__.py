"""ut_stems: split a song into vocals, bass, drums, guitars, piano and others."""

__version__ = "0.3.0"

STEMS = ["vocals", "bass", "drums", "guitars", "piano", "others"]
MODEL_NAMES = ["bs_roformer_sw", "htdemucs_6s"]
DEFAULT_MODEL = "bs_roformer_sw"


class Cancelled(Exception):
    """Raised inside a job when the user cancels it."""
