# UT Stems

Split a song into separate instrument tracks. Give it an audio file or a YouTube link and it writes
up to six MP3 stems: **vocals, bass, drums, guitars, piano, others**.

Everything runs on your own PC. It comes as a desktop app and as a command.

![UT Stems mixer](docs/screenshot.png)

## What it does

- **Input**: an audio file (MP3, WAV, FLAC, M4A, anything ffmpeg reads) or a YouTube link.
  A link is downloaded as audio only and saved as `<title>.mp3` next to the stems.
- **Stems**: pick any of the six. `others` collects everything that is not in a selected stem, so
  with `others` selected the files always add up to the whole song. Without it, the rest is not written.
- **Output**: `<songname>_<instrument>.mp3` at 320 kbps, in the folder you choose.
- **Queue**: add several files or links and they are separated one after another.
- **Mixer** (desktop app): waveform, solo, mute and volume per stem, with synchronised playback.
  A stem with nothing in it is marked *silent*.

The default model is BS-RoFormer SW; HT-Demucs 6s is available as a faster alternative.
On an RTX 3060 a 4-minute song takes about a minute and uses under 4 GB of VRAM.

## Download

The [latest release](https://github.com/zeberity123/ut_2_stems/releases/latest) has one small
installer for every PC and, next to it, the processing engine as one archive per edition:

| File | What it is | Size |
|---|---|---|
| `UT-Stems-<version>-win64-setup.exe` | the app; installs for the current user, no administrator rights, updates itself | about 4 MB |
| `UT-Stems-<version>-win64-portable.exe` | the same app without an installer: run it from any folder you can write to | about 6 MB |
| `UT-Stems-<version>-engine-cuda.7z` | engine for PCs with an NVIDIA GPU (GTX 10 series or newer, current driver) | about 1.7 GB |
| `UT-Stems-<version>-engine-xpu.7z` | engine for PCs with an Intel GPU: Arc A/B series, or the Arc graphics in Core Ultra laptops | about 1.2 GB |
| `UT-Stems-<version>-engine-cpu.7z` | engine for everything else (no GPU, or an AMD GPU) | about 200 MB |

1. Run the installer. Windows SmartScreen may warn because the program is not signed:
   **More info > Run anyway**.
2. Start UT Stems. On the first start it shows which graphics card it found, suggests the engine
   for it, and downloads and unpacks that engine (Python, PyTorch, the CUDA or oneAPI runtime and
   ffmpeg: about 4 GB on disk). That happens once; nothing else needs to be installed.

Without internet on that PC, or to save the download: put the engine's `.7z` file in that PC's
Downloads folder, or choose it with **Use a downloaded archive…** on the first-start page.
Every edition also runs on the CPU when its GPU is not found, so the CUDA edition is a safe choice
for any PC; the others are just smaller. The engine lives in `engine\` next to the app
(`%LOCALAPPDATA%\UT Stems`) and is removed with it when the app is uninstalled.

The command line is in the same folder: `engine\ut-stems.exe "song.mp3" -o D:\stems`.

**Updates.** The installed app checks the release page when it starts and offers a newer version;
**Install** downloads it, verifies its signature and runs the installer, which restarts the app. The
engine is kept unless the new version needs a new one. The portable exe cannot replace itself; it
shows the notice with a link to the release page instead.

**GPU or CPU.** Nothing besides the graphics driver needs to be installed: the CUDA edition carries
the CUDA runtime and the XPU edition carries Intel's oneAPI runtime. The header shows which device is
in use; *CPU · no supported GPU found* means the edition could not use a GPU, and the app then
recommends HT-Demucs 6s under the model choice. Times for a 4-minute song:

| Model | 8-core CPU (i7-10700F) | RTX 3060 |
|---|---|---|
| BS-RoFormer SW (default, best quality) | about 25 min | about 1 min |
| HT-Demucs 6s (choose it under *Advanced*) | about 2 min | about 15 s |

A laptop CPU with fewer cores takes proportionally longer. Intel GPUs: the XPU edition uses PyTorch's
Intel GPU back end, which needs a recent Intel graphics driver
([intel.com/download](https://www.intel.com/content/www/us/en/download-center/home.html), Arc or
Core Ultra graphics driver). It has not been timed on Intel hardware yet. Intel's NPU (*AI Boost*) is
not used: the separation models would have to be converted to OpenVINO first.

## Running from source

### Requirements

- Windows 10/11
- Python 3.10 or newer, on PATH (`winget install Python.Python.3.10`)
- An NVIDIA GPU with a current driver (it also runs on CPU, much slower)
- About 10 GB of free disk space
- ffmpeg and Node.js: `setup.bat` installs both with winget if they are missing

### Setup

```
git clone https://github.com/zeberity123/ut_2_stems.git
cd ut_2_stems
setup.bat
```

Without git, use **Code > Download ZIP** on GitHub, unzip, and run `setup.bat` in the folder.

`setup.bat` does four things:

1. installs ffmpeg if it is missing
2. installs Node.js if it is missing (for YouTube downloads and the Tauri command line)
3. installs the Python packages into your default Python, with no virtual environment. PyTorch is
   a download of about 2.5 GB; an existing PyTorch is kept as it is.
4. installs the Node packages (the Tauri command line and Playwright, for the tests)

If it had to install ffmpeg or Node.js, start `run.bat` from a new window so they are found.
The first separation downloads the model checkpoint (about 670 MB) to
`%USERPROFILE%\.cache\bs-roformer-infer`.

The repository holds only code. Songs, separated stems and model files are never uploaded.

## Use

### Desktop app

Double-click `run.bat`. It opens the Tauri window if it has been built (`cargo build` in
`src-tauri`), otherwise the interface in your browser.

1. Paste a YouTube link, choose files, or drop files on the window.
2. Select the stems you want.
3. Choose the output folder and press **Separate stems**.

When it finishes, the stems open in the mixer and **Open folder** shows the files.

**Format.** *Auto* writes 24-bit WAV stems for a lossless file (WAV, FLAC, AIFF) and 320 kbps MP3
stems for everything else, YouTube included; *MP3* and *WAV* force one or the other.

**Theme.** The button at the top right steps through light, dark and *Miku* (black, the teal
`#39c5bb`, red for what is live). Without a choice the app follows Windows.

To separate several songs, add them one by one with **Add** (or Enter), or pick several files at
once. They appear in the **Songs** list on the left and nothing starts until you press
**Separate**. Then:

- to rename a song, double-click it in the list or press **✎**, type the name and press Enter
  (Esc cancels). Before separation the files are then written under that name; after it, the
  files already written are renamed (an existing file of that name is never overwritten).
- a YouTube song you did not rename takes the video title as soon as it starts
- the songs run one after another with the stems, folder and model set at that moment
- you can open and play a finished song while the next one is running
- songs added during a run wait until you press **Separate** again
- **Cancel** stops the run and puts the unfinished songs back to *Ready*
- a song that fails is marked *Failed* and the rest carry on

Under **Advanced** → *Files* there are two toggles, both on by default:

- **Auto title**: a YouTube song you did not rename is named after its video title. Off, it is
  named after its video id (for example `suv0x6HfRhw_vocals.mp3`).
- **Keep original MP3**: the downloaded song stays next to the stems as `<songname>.mp3`. Off, it
  is deleted once the stems are written. Files you chose yourself are never deleted.

### Command line

The `ut-stems` command works from any folder.

```
ut-stems "song.mp3"
ut-stems "song.mp3" -o D:\stems
ut-stems "first.mp3" "second.mp3" "https://youtu.be/suv0x6HfRhw"
ut-stems "https://youtu.be/suv0x6HfRhw" --stems vocals,bass,drums,guitars
```

| Option | Meaning | Default |
|---|---|---|
| `-o`, `--out` | output folder | `./output` |
| `--stems` | comma-separated stems to write | all six |
| `--model` | `bs_roformer_sw` or `htdemucs_6s` | `bs_roformer_sw` |
| `--overlap` | `2`, `3` or `4`; higher is slower and slightly smoother | `2` |
| `--format` | `auto`, `mp3` or `wav`; auto keeps lossless files lossless | `auto` |
| `--bitrate` | MP3 bitrate | `320k` |
| `--device` | `auto`, `cuda` (NVIDIA), `xpu` (Intel GPU) or `cpu` | `auto` |

## How it is built

| Part | Where |
|---|---|
| Separation, YouTube download, MP3 I/O | `ut_stems/` (Python) |
| One pipeline shared by the app and the command | `ut_stems/pipeline.py` |
| Local server for the app (127.0.0.1, session token) | `ut_stems/server.py` |
| Interface | `web/` (plain HTML, CSS and JS; light and dark; set in [Pretendard](https://github.com/orioncactus/pretendard), SIL OFL, `web/fonts/`) |
| Interactive parts of the interface | ported from [Lucian UX/UI Prompt](https://lucianlabs.dev/uxui-prompt/) (MIT), see `web/styles.css` |
| Desktop shell | `src-tauri/` (Rust, Tauri 2, the WebView2 that comes with Windows) |
| Standalone build | `packaging/` (PyInstaller spec, `build.ps1`) |

The app structure follows [yt_to_score](https://github.com/zeberity123/yt_to_score); the YouTube audio
download follows [ut_downloader](https://github.com/zeberity123/ut_downloader). The interface keeps to
one rule: it is monochrome, and colour belongs to the audio (each stem has its colour and nothing else
does). Its moving parts come from Lucian UX/UI Prompt, MIT-licensed: the drop zone (#432), checkbox and
switch (#433), segmented control (#416), the queue-to-progress bar and step log (#083), inline title
editing (#033), the play–pause morph (#007), toasts (#435) and the circular theme reveal (#219, done
with the View Transitions API). The theme button in the header switches between light and dark; without
a choice the app follows Windows.

## Tests

```
python -m pytest             fast tests, no model needed
python -m pytest -m slow     separation on a short clip, needs the GPU
npm run test:tauri           the Tauri window: separates a clip, renames it, closes, engine stops
node scripts/test-update.cjs dist\UT-Stems-0.6.0-win64-setup.exe 0.6.1
                             installs that version and checks it updates itself to the given one
```

`test:tauri` drives the WebView2 window through Playwright over the DevTools protocol; set
`UT_STEMS_TEST_APP` to an installed `UT Stems.exe` to test the installed app instead of the debug build.

## Building the standalone app

`packaging\build.ps1` builds the folder that the releases contain. It needs 7-Zip
(`winget install 7zip.7zip`) and Node.js, and about 15 GB of free disk space for the CUDA edition.

```
packaging\build.ps1 -Edition cuda                                        # default Python has the CUDA torch
packaging\build.ps1 -Edition xpu -Python C:\envs\xpu\Scripts\python.exe  # a Python with torch from whl/xpu
packaging\build.ps1 -Edition cpu -Python C:\envs\cpu\Scripts\python.exe  # a Python with the CPU torch
```

The engine stage also fetches [QuickJS-ng](https://github.com/quickjs-ng/quickjs) (MIT, pinned by
hash) into the engine folder: yt-dlp needs a JavaScript runtime for YouTube, and this one is 1.9 MB.

The result is `dist\UT-Stems-<version>-win64-<edition>-setup.exe`, an NSIS installer that installs
for the current user (no administrator rights). It is built in two stages: `engine` makes the Python
side with PyInstaller (`ut-stems-engine.exe`, the local server, and `ut-stems.exe`, the command line,
from `packaging\ut_stems.spec`, plus ffmpeg) and `tauri` builds the window with `tauri build` and
puts the engine folder inside the installer as `engine\` next to the executable. The window starts
the engine with a session token and opens its page; the engine exits on its own if the window goes
away. The window itself is about 10 MB: Tauri uses the WebView2 runtime that is part of Windows 10/11
instead of shipping a browser.

## Notes

- The packaged app includes ffmpeg from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (GPL; its
  licence is in `resources\engine\ffmpeg-LICENSE.txt`), PyTorch, yt-dlp, Demucs and BS-RoFormer.

- The BS-RoFormer SW checkpoint is a community release whose licence is listed as unknown on
  Hugging Face. It is downloaded at run time and is not part of this repository.
- Only download and separate music you have the right to use.
- `PLAN.md` records the model comparison and the decisions made along the way.
