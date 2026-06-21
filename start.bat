@echo off
REM ---- Ticket Scoring System launcher ----
REM Double-click this file to start the app. Keep the window open while using it.

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

REM Open the browser shortly after the server starts.
start "" "http://localhost:4321"

node "%~dp0server.js"

echo.
echo   The app has stopped. You can close this window.
pause
