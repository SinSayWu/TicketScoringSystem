@echo off
title Ticket Scoring System
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install it from https://nodejs.org/ then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Starting the Ticket Scoring System...
node "%~dp0server.js"

echo.
echo The app has stopped. You can close this window.
pause
