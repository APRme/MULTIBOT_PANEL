@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-multibot-panel.ps1" %*
exit /b %ERRORLEVEL%
