@echo off
setlocal
cd /d "%~dp0"
rem The Tauri window (cargo build in src-tauri), or the interface in the browser.
if exist "src-tauri\target\release\ut-stems.exe" (
    start "" "src-tauri\target\release\ut-stems.exe"
) else if exist "src-tauri\target\debug\ut-stems.exe" (
    start "" "src-tauri\target\debug\ut-stems.exe"
) else (
    echo The Tauri window is not built (cargo build in src-tauri). Opening the interface in your browser instead.
    python -m ut_stems.server --open
    if errorlevel 1 pause
)
