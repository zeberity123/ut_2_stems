@echo off
rem UT Stems Client: the same window, but songs are separated on the PC running ut_stems_server.bat.
setlocal
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" "desktop\client.cjs"
) else (
    echo Electron is not installed. Run "npm install" in this folder,
    echo or use the packaged "UT Stems Client.exe" on PCs without this folder.
    pause
)
