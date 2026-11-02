@echo off
rem UT Stems Server: other PCs send songs here and this PC separates them.
rem Keep the window open while they use it. See README.md, "Separating for other PCs".
setlocal
cd /d "%~dp0"
title UT Stems Server

rem Once: let other PCs reach port 47900 through Windows Firewall (Windows asks for permission).
netsh advfirewall firewall show rule name="UT Stems Server" >nul 2>&1
if errorlevel 1 (
    echo Adding a Windows Firewall rule for port 47900. Windows asks for permission...
    powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','New-NetFirewallRule -DisplayName ''UT Stems Server'' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 47900 -Profile Any | Out-Null; New-NetFirewallRule -DisplayName ''UT Stems Server'' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 47900 -Profile Any | Out-Null'"
    netsh advfirewall firewall show rule name="UT Stems Server" >nul 2>&1
    if errorlevel 1 echo The firewall rule was not added; other PCs may not reach this one.
    echo.
)

python -m ut_stems.remote %*
if errorlevel 1 pause
