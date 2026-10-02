@echo off
setlocal
cd /d "%~dp0"
echo Installing the Python packages into your default Python...
python -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
if errorlevel 1 goto :failed
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed
python -m pip install -e .
if errorlevel 1 goto :failed
where ffmpeg >nul 2>nul
if errorlevel 1 echo WARNING: ffmpeg was not found. Install it with: winget install Gyan.FFmpeg
where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install it with: winget install OpenJS.NodeJS.LTS
    echo Until then run.bat opens the interface in your browser.
) else (
    call npm install
    if errorlevel 1 goto :failed
    if not exist "node_modules\electron\dist\electron.exe" node node_modules\electron\install.js
)
echo.
echo Ready. Double-click run.bat to open UT Stems.
pause
exit /b 0
:failed
echo.
echo Setup failed. Install Python 3.10 or newer with "Add Python to PATH", then retry.
pause
exit /b 1
