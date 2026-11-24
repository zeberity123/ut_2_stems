@echo off
setlocal
cd /d "%~dp0"
rem The Tauri window (cargo build in src-tauri), the Electron window (npm install), or the browser.
if exist "src-tauri\target\release\ut-stems.exe" (
    start "" "src-tauri\target\release\ut-stems.exe"
) else if exist "src-tauri\target\debug\ut-stems.exe" (
    start "" "src-tauri\target\debug\ut-stems.exe"
) else if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" .
) else (
    echo Neither the Tauri nor the Electron window is built. Opening the interface in your browser instead.
    python -m ut_stems.server --open
    if errorlevel 1 pause
)
