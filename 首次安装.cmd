@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<12)) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] Node.js version is too old. Version 22.12 or newer is required.
  pause
  exit /b 1
)
echo [1/4] Installing locked project dependencies...
call npm.cmd ci
if errorlevel 1 goto :failed
echo [2/4] Installing the local Chromium runtime...
call npx.cmd playwright install chromium
if errorlevel 1 goto :failed
echo [3/4] Verifying and downloading pinned model assets...
call npm.cmd run setup:models
if errorlevel 1 goto :failed
echo [4/4] Building and checking the environment...
call npm.cmd run build
if errorlevel 1 goto :failed
call npm.cmd run doctor
if errorlevel 1 goto :failed
echo.
echo Base setup complete. Basic classification is ready without Ollama.
echo.
choice /C YN /N /M "Install the optional local Qwen 3.5 4B vision model now? [Y/N] "
if errorlevel 2 goto :base_complete
call npm.cmd run setup:vision
if errorlevel 1 goto :failed
:base_complete
echo.
echo For local natural-language image explanations, run 安装本地视觉模型.cmd once.
echo It installs Ollama if needed and downloads the recommended Qwen 3.5 4B model.
echo Setup does not install a startup service.
pause
exit /b 0
:failed
echo.
echo Setup failed. Fix the error above and run this script again.
pause
exit /b 1
