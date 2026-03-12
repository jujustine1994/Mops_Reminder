@echo off
echo %~dp0 | findstr /r "[^a-zA-Z0-9_\-\.\\: ]" >nul
if %errorlevel% equ 0 (
    echo [WARNING] The folder path contains special characters or spaces.
    echo [WARNING] This may cause launch failure.
    echo [WARNING] Please move the program to a simple path such as C:\TWSTOCK_RADAR\
    echo.
    pause
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if %errorlevel% neq 0 pause
