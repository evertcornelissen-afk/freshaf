@echo off
title FreshAF
cd /d "%~dp0"

rem If the server is already running, just open the app.
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:5757/api/pricing' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto open

rem Start the server minimized in its own window.
start "FreshAF Server" /min cmd /c "node server\index.js"
timeout /t 2 /nobreak >nul

:open
start "" http://localhost:5757
exit
