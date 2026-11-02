"""Where the files are, both in a source checkout and inside the packaged app.

The packaged app is a PyInstaller folder: ``ut-stems-engine.exe`` and ``ut-stems.exe`` next
to an ``_internal`` folder that holds Python, the libraries and the ``web`` interface.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
# Folder of the executables in the packaged app, or the repository root.
ROOT = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent.parent
# Folder of the bundled files (``_internal`` in the packaged app, the repository root otherwise).
BUNDLE = Path(getattr(sys, "_MEIPASS", ROOT))
WEB = BUNDLE / "web"


def default_output() -> Path:
    """Where stems go when no folder is chosen: ``UT_STEMS_OUTPUT``, else a sensible folder."""
    chosen = os.environ.get("UT_STEMS_OUTPUT")
    if chosen:
        return Path(chosen)
    if FROZEN:
        # The app folder may be read-only (for example under Program Files).
        return Path.home() / "Music" / "UT Stems"
    return ROOT / "output"
