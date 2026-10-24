@echo off
cd /d "%~dp0"
call npm.cmd run start:folder
if errorlevel 1 pause
