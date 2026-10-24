@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\manage-startup.ps1" -Mode install
if errorlevel 1 pause
