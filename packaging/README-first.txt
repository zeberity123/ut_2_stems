UT Stems - split a song into vocals, bass, drums, guitars, piano and others
===========================================================================

Start:      double-click "UT Stems.exe"
Command:    ut-stems.cmd "song.mp3" -o "D:\stems"       (run from this folder)

Keep everything in this folder together. You can move the folder anywhere.

The first separation downloads the model (about 670 MB for BS-RoFormer SW,
about 80 MB for HT-Demucs 6s) to %USERPROFILE%\.cache. After that it works offline,
except for YouTube links.

GPU: the cuda edition uses an NVIDIA GPU (a 4-minute song in about a minute on an
RTX 3060), the xpu edition an Intel GPU (Arc, or the graphics in Core Ultra chips).
Only a current graphics driver is needed; the GPU libraries are inside this folder.
The header of the window names the device in use. Without a usable GPU it runs on
the CPU, which is much slower; pick "HT-Demucs 6s" under Advanced for a faster result.

Windows SmartScreen may warn because the program is not signed:
"More info" > "Run anyway".

Source and updates: https://github.com/zeberity123/ut_2_stems
