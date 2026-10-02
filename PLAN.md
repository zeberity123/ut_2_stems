# ut_2_stems — plan

Goal: take one MP3 as input and write 6 stems: `vocals`, `bass`, `drums`, `guitars`, `piano`, `others`.

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

Not yet verified, to be settled in phase 2:

- Whether BS-RoFormer SW fits in 12 GB VRAM at default chunk size, and how long a 4-minute song takes.
- The licence terms of the SW checkpoint. It is a community release; weights will never be committed to this repo either way.

## Phases

0. **Repo** — done. `github.com/zeberity123/ut_2_stems` (public), local repo in `C:\ut_stems` on `main`, remote `origin` set.
1. **Environment** — done. Packages installed into the default Python 3.10 (no venv, so they are usable from other folders): `torch` CUDA build, `bs-roformer-infer`, `demucs`; see `requirements.txt`. ffmpeg via `winget install Gyan.FFmpeg`. `.gitignore` for weights, audio and outputs. `torchaudio` is deliberately not installed: neither package needs it and its latest build pins an older torch.
2. **Spike** — run both models on `audio_sample/だから僕は音楽を辞めた.mp3`; record run time and peak VRAM; listen to guitar and piano stems. Pick the model from the results.
3. **CLI** — `python -m ut_stems song.mp3 [-o out_dir] [--model ...]`:
   - validate input, decode MP3 to 44.1 kHz stereo
   - separate on GPU, fall back to CPU if no CUDA
   - write `out_dir/<songname>_{vocals,bass,drums,guitars,piano,others}.mp3` at 320 kbps
4. **Verification** — check that the 6 stems sum back to the original mix within a small residual; a test on a short clip; README with install and usage.
5. **Optional later** — batch folder mode, simple web UI, ensembling models for better guitar/piano.

## Defaults assumed

- Output is 320 kbps MP3 named `<songname>_<instrument>.mp3`. Lossless output is not a goal; clean separation between instruments is.
- CLI first; no UI until the separation itself is good.
- No audio files or model weights in the public repo.
