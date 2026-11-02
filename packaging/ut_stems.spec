# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the processing engine of the packaged app. Run through build.ps1.
#
# Produces one folder with two programs that share the same libraries:
#   ut-stems-engine.exe   the local server behind the desktop window (also: --open for a browser)
#   ut-stems.exe          the command line
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).parent
icon = str(root / "packaging" / "icon.ico")

datas = [(str(root / "web"), "web")]
datas += collect_data_files("bs_roformer")  # model configs and registry
datas += collect_data_files("demucs")       # remote model index
# The Intel GPU build of torch loads Intel's oneAPI runtime from <python>/Library/bin, which in
# the packaged app is _internal/Library/bin (torch looks in sys.exec_prefix/Library/bin).
runtime_bin = Path(sys.exec_prefix) / "Library" / "bin"
if runtime_bin.is_dir():
    datas += [(str(f), "Library/bin") for f in runtime_bin.iterdir()
              if f.is_file() and f.suffix not in (".pdb", ".lib")]
hiddenimports = collect_submodules("demucs") + collect_submodules("bs_roformer")
excludes = ["tkinter", "matplotlib", "IPython", "jupyter", "notebook", "pytest", "_pytest", "PIL",
            "pandas", "sklearn", "scipy", "tensorboard", "torch.utils.tensorboard", "torchvision",
            "torchaudio", "onnx", "onnxruntime", "triton", "setuptools", "pkg_resources"]


def analysis(script):
    return Analysis([str(root / "packaging" / script)], pathex=[str(root)], binaries=[], datas=datas,
                    hiddenimports=hiddenimports, hookspath=[], runtime_hooks=[], excludes=excludes,
                    noarchive=False)


engine = analysis("engine_entry.py")
cli = analysis("cli_entry.py")

engine_exe = EXE(PYZ(engine.pure), engine.scripts, [], exclude_binaries=True,
                 name="ut-stems-engine", icon=icon, console=True, upx=False)
cli_exe = EXE(PYZ(cli.pure), cli.scripts, [], exclude_binaries=True,
              name="ut-stems", icon=icon, console=True, upx=False)

COLLECT(engine_exe, cli_exe, engine.binaries, engine.datas, cli.binaries, cli.datas,
        strip=False, upx=False, name="engine")
