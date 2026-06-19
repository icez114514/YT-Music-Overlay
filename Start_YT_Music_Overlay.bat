@echo off
setlocal
cd /d "%~dp0app"
npm start
if errorlevel 1 (
  echo.
  echo Failed to start YT Music Overlay.
  pause
)
