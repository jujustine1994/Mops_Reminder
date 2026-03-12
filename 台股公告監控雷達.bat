@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0台股公告監控雷達.ps1"
if %errorlevel% neq 0 pause
