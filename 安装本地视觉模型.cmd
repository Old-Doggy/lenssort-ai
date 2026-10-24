@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.12 or newer is required.
  echo Please run 首次安装.cmd first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [ERROR] Dependencies are not installed.
  echo Please run 首次安装.cmd first.
  pause
  exit /b 1
)
echo.
echo LensSort AI will install Ollama if it is missing, then download Qwen 3.5 4B.
echo The model may use several GB of disk space. Photos stay on this computer.
echo.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0
call npm.cmd run setup:vision
if errorlevel 1 (
  echo.
  echo [ERROR] Local vision model setup failed. Check the message above and run this script again.
  pause
  exit /b 1
)
echo.
echo Vision model setup complete. Start LensSort with 启动网页控制.cmd.
pause
exit /b 0
