# ut_2_stems — plan

Goal: take one MP3 or a YouTube link as input and write up to 6 stems: `vocals`, `bass`, `drums`, `guitars`, `piano`, `others`.

## Machine (checked 2026-10-02)

| Item | Status |
|---|---|
| OS | Windows 11 Pro |
| GPU | NVIDIA RTX 3060, 12 GB VRAM |
| RAM / free disk | 32 GB / ~74 GB on C: |
| Python | 3.10.11 (only version installed), pip 26.2.1 |
| PyTorch | 2.14.1+cu126, CUDA confirmed working on the 3060 |
| git | 2.52, identity `zeberity123` |
| ffmpeg | 9.0.2 (winget, Gyan full build, includes libmp3lame) |
| gh CLI | missing — not required, git + stored credential work |

## Model choice

| Model | Stems | Quality (SDR, dB, from MVSEP) | Notes |
|---|---|---|---|
| **BS-RoFormer SW** (primary) | all 6 in one pass | vocals 11.30, bass 14.62, drums 14.11, guitar 9.05, piano 7.83, other 8.71 | ~700 MB community checkpoint, downloaded from Hugging Face |
| `htdemucs_6s` (fallback) | all 6 in one pass | vocals ~8.7, drums ~9.5, bass ~9.1, other ~5.7; no published guitar/piano numbers | Official Demucs model; its authors describe the piano stem as having heavy bleeding and artifacts |

Runner for the primary model: `bs-roformer-infer` (MIT, inference only, downloads and hash-checks the checkpoint).
Runner for the fallback: `demucs` or `audio-separator`.

### Phase 2 results (RTX 3060, 4:06 sample song, `spike/compare_models.py`)

| | BS-RoFormer SW | `htdemucs_6s` |
|---|---|---|
| Inference time | 34.6 s (about 7x realtime) | under 21 s including model download and load |
| Peak VRAM | 3.77 GB | 0.6 GB |
| Six stems summed vs original mix | 32.2 dB (near-perfect reconstruction) | 17.6 dB |
| `others` stem level vs mix | -82 dB (silent) | -22 dB |

- Both models fit easily in 12 GB. BS-RoFormer SW is the default; `htdemucs_6s` stays available as an option.
- SW's `others` stem is silent for the sample song. The output is not broken: fed a synth pad or a sine tone, the model routes all of it to `others`. For this song it assigned everything to the five named instruments.
- The two models agree closely on vocals and drums (11–12 dB) and bass (8 dB), and differ most on guitars and piano (4.5–5 dB). Those two stems are where listening decides.
- Licence of the SW checkpoint: the Hugging Face page (`enerjazzer/BS-ROFO-SW-Fixed`) lists it as unknown. Weights are downloaded to the user cache at run time and never committed to this repo.

## Phases

0. **Repo** — done. `github.com/zeberity123/ut_2_stems` (public), local repo in `C:\ut_stems` on `main`, remote `origin` set.
1. **Environment** — done. Packages installed into the default Python 3.10 (no venv, so they are usable from other folders): `torch` CUDA build, `bs-roformer-infer`, `demucs`; see `requirements.txt`. ffmpeg via `winget install Gyan.FFmpeg`. `.gitignore` for weights, audio and outputs. `torchaudio` is deliberately not installed: neither package needs it and its latest build pins an older torch.
2. **Spike** — done, results above. Run both models on `audio_sample/だから僕は音楽を辞めた.mp3`; record run time and peak VRAM; listen to guitar and piano stems. Pick the model from the results.
3. **CLI** — done. `ut-stems song.mp3 [-o out_dir] [--model bs_roformer_sw|htdemucs_6s] [--overlap 2|3|4] [--bitrate 320k] [--device auto|cuda|cpu]` (same as `python -m ut_stems ...`):
   - installed into the default Python with `pip install -e .`, so the command works from any folder
   - validates input, decodes to 44.1 kHz stereo with ffmpeg
   - separates on GPU, falls back to CPU if no CUDA
   - writes `out_dir/<songname>_{vocals,bass,drums,guitars,piano,others}.mp3` at 320 kbps (default `out_dir` is `./output`)
   - checked on the sample: about 55 s end to end for the 4:06 song; the decoded MP3 stems sum back to the original at 31.8 dB
4. **Desktop app, YouTube input, stem selection, verification** — done.
   - **Desktop app**: Electron shell (`desktop/`) around a local Python server (`ut_stems/server.py`) and a web interface (`web/`), the same structure and look as `zeberity123/yt_to_score`. Source, stem and output controls on the right; the result opens as a mixer with a waveform, solo, mute and volume per stem and synchronised playback. Start it with `run.bat`.
   - **YouTube input**: a link is downloaded as audio only and saved as `<title>.mp3` (320 kbps) next to the stems, using the yt-dlp settings from `zeberity123/ut_downloader`. Playlist parameters in the link are ignored.
   - **Stem selection**: choose any of the six stems in the app, or `--stems vocals,bass,drums,guitars` on the command line. `others` collects everything that is not in a selected stem; if `others` is not selected, that audio is not written.
   - **Separation loop**: `ut_stems/models.py` now runs its own chunked loop (progress and cancel for the app). Its raw output matches `bs_roformer.demix_track` to 1e-7 on the full sample song.
   - **Tests**: `python -m pytest` (fast tests: audio, selection, input handling, server), `python -m pytest -m slow` (4 GPU tests on a short clip, including that the stems sum back to the song), `npm run test:desktop` (launches the app, separates a clip, checks the mixer and synchronised playback).
   - **Checked by hand through the app** with both YouTube links: `3J5uLk1DJV0` (all six stems, 62 s) and `CkvWJNt77mU` (all six, 74 s; and vocals/bass/drums/guitars only, 67 s). For `CkvWJNt77mU` the model puts piano at -37.6 dB (one short blip) and `others` at -19 dB.
5. **Song queue** — done (chosen from the optional list).
   - The app has a **Songs** list: add links or files one by one, pick several files, or drop several. Nothing runs until Separate is pressed; the songs then run one after another with the settings of that moment.
   - A finished song can be opened and played while the next one runs. Cancel returns unfinished songs to Ready; a failed song does not stop the others.
   - `ut-stems` accepts several inputs and continues past a bad one.
   - Server state lists the songs without waveforms; a song's full result is fetched once when it is opened.
   - Checked through the app: two queued clips (automated), a YouTube link and a local file queued with four stems, and Cancel during a run followed by a restart.
6. **Optional later** — a packaged installer, Korean/Japanese interface text, ensembling models for better guitar/piano.

## Defaults assumed

- Output is 320 kbps MP3 named `<songname>_<instrument>.mp3`. Lossless output is not a goal; clean separation between instruments is.
- The command line and the desktop app share one pipeline (`ut_stems/pipeline.py`).
- No audio files or model weights in the public repo.
