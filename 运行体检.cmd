@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
call npm.cmd run doctor
if errorlevel 1 (
  echo [ERROR] Environment check failed.
  pause
  exit /b 1
)
echo Environment check complete.
pause
