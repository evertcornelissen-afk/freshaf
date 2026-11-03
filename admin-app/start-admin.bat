@echo off
title FreshAF Admin
cd /d "%~dp0"
if not exist node_modules ( echo Installing dependencies... && call npm install )
start "" http://localhost:5858
node server.js
pause
