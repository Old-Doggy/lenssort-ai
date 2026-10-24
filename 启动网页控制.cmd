@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.12 or newer is required.
  echo Run the first-time setup script in this folder.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [ERROR] Dependencies are not installed.
  echo Run the first-time setup script in this folder.
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo Building the web app...
  call npm.cmd run build
  if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)
echo Starting LensSort AI. Keep this window open while using the web page.
call npm.cmd run start:control -- --open
if errorlevel 1 (
  echo [ERROR] The control server stopped or failed to start.
  pause
)
