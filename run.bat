@echo off
setlocal
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" .
) else (
    echo Electron is not installed. Run "npm install" in this folder for the desktop window.
    echo Opening the interface in your browser instead.
    python -m ut_stems.server --open
    if errorlevel 1 pause
)
