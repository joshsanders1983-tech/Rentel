@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Rentel.ps1"
if errorlevel 1 (
  echo.
  pause
)
