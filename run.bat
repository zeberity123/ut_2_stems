@echo off
setlocal
cd /d "%~dp0"
rem The Tauri window, built with: cargo build --release  in src-tauri. Otherwise the interface opens in the browser.
rem No parentheses inside the blocks below: cmd would take them as the end of the block.
if exist "src-tauri\target\release\ut-stems.exe" (
    start "" "src-tauri\target\release\ut-stems.exe"
) else if exist "src-tauri\target\debug\ut-stems.exe" (
    start "" "src-tauri\target\debug\ut-stems.exe"
) else (
    echo The Tauri window is not built yet. Opening the interface in your browser instead.
    python -m ut_stems.server --open
    if errorlevel 1 pause
)
