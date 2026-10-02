@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto :no_python

where ffmpeg >nul 2>nul
if not errorlevel 1 goto :ffmpeg_ok
echo [1/4] Installing ffmpeg...
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 echo WARNING: ffmpeg could not be installed. Install it yourself: winget install Gyan.FFmpeg
goto :node
:ffmpeg_ok
echo [1/4] ffmpeg found.

:node
where npm >nul 2>nul
if not errorlevel 1 goto :node_ok
echo [2/4] Installing Node.js...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
goto :python
:node_ok
echo [2/4] Node.js found.

:python
echo [3/4] Installing the Python packages into your default Python...
python -m pip install --upgrade pip
if errorlevel 1 goto :failed
rem Keep an existing PyTorch; otherwise install the CUDA build (about 2.5 GB download).
python -c "import torch" >nul 2>nul
if not errorlevel 1 goto :torch_ok
python -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
if errorlevel 1 goto :failed
:torch_ok
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed
python -m pip install -e .
if errorlevel 1 goto :failed

echo [4/4] Installing the desktop window...
where npm >nul 2>nul
if errorlevel 1 goto :no_node
call npm install
if errorlevel 1 goto :failed
if not exist "node_modules\electron\dist\electron.exe" node node_modules\electron\install.js
if not exist "node_modules\electron\dist\electron.exe" goto :failed

echo.
python -c "import torch; print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'not found - separation will run on the CPU and be slow')"
echo Ready. Double-click run.bat to open UT Stems.
echo The first separation downloads the model (about 670 MB).
pause
exit /b 0

:no_python
echo Python was not found. Install Python 3.10 or newer, for example:
echo     winget install Python.Python.3.10
echo Then open a new window and run setup.bat again.
pause
exit /b 1

:no_node
echo.
echo Node.js is not available in this window yet. Close it and run setup.bat again.
pause
exit /b 1

:failed
echo.
echo Setup failed. Read the messages above, then run setup.bat again.
pause
exit /b 1
