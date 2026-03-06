@echo off
title TWSTOCK RADAR - Created by CTH
color 0a
cls

:: Change to the current directory
cd /d "%~dp0"

echo ========================================================
echo   TWSTOCK RADAR - Taiwan Stock Monitor System
echo   Created by CTH
echo ========================================================
echo.

:: 1. Check for Node.js
echo [1/3] Checking Node.js environment...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is NOT installed.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit
)

:: 2. Check for port 7853
echo [2/3] Checking if port 7853 is available...
netstat -ano | findstr :7853 >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARNING] Port 7853 is already in use. 
    echo Please close other windows or software using this port.
    pause
    exit
)

:: 3. Check for dependencies
if not exist node_modules (
    echo [3/3] Installing dependencies... This may take a few minutes.
    call npm install --no-fund --no-audit
) else (
    echo [3/3] Dependencies found. Starting system...
)

echo.
echo [START] Launching Backend Server and Browser...
echo (Keep this window open to run the system)
echo.

:: Launch the server
node src/server.js

:: Keep the window open if something fails
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The program crashed or stopped unexpectedly.
    pause
)

echo.
echo Closing in 5 seconds...
timeout /t 5
