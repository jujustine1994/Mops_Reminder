@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title TWSTOCK RADAR - Created by CTH
color 0a
cls

cd /d "%~dp0"

echo ========================================================
echo   TWSTOCK RADAR - Taiwan Stock Monitor System
echo   監控台灣 MOPS 公開資訊觀測站公告，自動寄送 Email 通知
echo   Created by CTH
echo ========================================================
echo.

:: ============================================================
:: [1/4] 檢查 Node.js
:: ============================================================
echo [1/4] 檢查 Node.js 環境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] 未偵測到 Node.js，本程式需要 Node.js 才能執行。
    echo.
    set /p INSTALL_NODE=是否要立即安裝 Node.js？[Y/n]（直接按 Enter 代表同意）：
    if "!INSTALL_NODE!"=="" set INSTALL_NODE=Y
    if /i "!INSTALL_NODE!" neq "Y" (
        echo 已取消。請安裝 Node.js 後重新啟動。
        pause
        exit /b 1
    )
    echo.
    :: 優先用 winget
    winget --version >nul 2>&1
    if !errorlevel! equ 0 (
        echo [INFO] 使用 winget 安裝 Node.js LTS，請稍候...
        winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
    ) else (
        :: winget 不存在，改用 PowerShell 下載 MSI 靜默安裝
        echo [INFO] 正在下載 Node.js 安裝程式，請稍候...
        powershell -NoProfile -Command ^
            "$ver = ((Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object {$_.lts} | Select-Object -First 1).version;" ^
            "$url = \"https://nodejs.org/dist/$ver/node-$ver-x64.msi\";" ^
            "$out = \"$env:TEMP\node_lts.msi\";" ^
            "Write-Host \"[INFO] 下載 $url ...\";" ^
            "Invoke-WebRequest $url -OutFile $out;" ^
            "Write-Host '[INFO] 安裝中...';" ^
            "Start-Process msiexec.exe -ArgumentList \"/i $out /quiet /norestart\" -Wait;" ^
            "Remove-Item $out -Force -EA SilentlyContinue"
    )
    :: 嘗試刷新 PATH
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\")"') do set "PATH=%%i;%PATH%"
    node -v >nul 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo [INFO] 安裝完成，但需要重新開啟視窗才能生效。
        echo        請關閉此視窗後重新執行本程式。
        pause
        exit /b 0
    )
    echo [OK] Node.js 安裝完成。
) else (
    for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js %%v 已安裝。
)

:: ============================================================
:: [2/4] 檢查 Google Chrome
:: ============================================================
echo.
echo [2/4] 檢查 Google Chrome 瀏覽器...
set "CHROME_EXE="

:: 先讀 .env 裡的 CHROME_PATH
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if "%%a"=="CHROME_PATH" set "CHROME_EXE=%%b"
    )
)
if defined CHROME_EXE (
    if exist "!CHROME_EXE!" (
        echo [OK] 使用已儲存的 Chrome 路徑：!CHROME_EXE!
        goto chrome_ok
    )
    set "CHROME_EXE="
)

:: 查詢 Registry
for /f "delims=" %%p in ('powershell -NoProfile -Command "try{$v=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -EA Stop).'(default)';if(Test-Path $v){$v}else{''}}catch{''}"') do (
    if not "%%p"=="" set "CHROME_EXE=%%p"
)
if defined CHROME_EXE (
    echo [OK] 從 Registry 找到 Chrome：!CHROME_EXE!
    goto save_chrome
)

:: 逐一檢查常見路徑
set "P0=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "P1=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "P2=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
for %%p in ("!P0!" "!P1!" "!P2!") do (
    if exist %%p (
        set "CHROME_EXE=%%~p"
        echo [OK] 找到 Chrome：!CHROME_EXE!
        goto save_chrome
    )
)

:: 都找不到 → 警告 + 詢問安裝
echo [WARNING] 找不到 Google Chrome。
echo.
echo   !! 注意 !!
echo   本程式使用 Chrome 爬取 MOPS 公告資料。
echo   沒有安裝 Chrome，公告爬取功能將完全無法運作。
echo.
set /p INSTALL_CHROME=是否要立即安裝 Google Chrome？[Y/n]（直接按 Enter 代表同意）：
if "!INSTALL_CHROME!"=="" set INSTALL_CHROME=Y
if /i "!INSTALL_CHROME!" neq "Y" (
    :: 使用者拒絕安裝 → 讓他手動選路徑（或許他有裝在奇怪地方）
    echo.
    echo   如果您已安裝 Chrome 但未被偵測到，可以手動指定路徑。
    echo   否則請先安裝 Google Chrome 後重新啟動本程式。
    echo.
    set /p PICK_CHROME=是否要手動選擇 chrome.exe 路徑？[Y/n]：
    if "!PICK_CHROME!"=="" set PICK_CHROME=Y
    if /i "!PICK_CHROME!" neq "Y" (
        echo.
        echo [ERROR] 沒有 Chrome，公告爬取功能無法使用。請安裝後重新啟動。
        pause
        exit /b 1
    )
    goto chrome_pick
)

:: 安裝 Chrome
winget --version >nul 2>&1
if !errorlevel! equ 0 (
    echo [INFO] 使用 winget 安裝 Google Chrome，請稍候...
    winget install --id Google.Chrome -e --silent --accept-source-agreements --accept-package-agreements
) else (
    :: winget 不存在，改用 PowerShell 下載安裝程式靜默安裝
    echo [INFO] 正在下載 Google Chrome 安裝程式，請稍候...
    powershell -NoProfile -Command ^
        "$out = \"$env:TEMP\chrome_installer.exe\";" ^
        "Invoke-WebRequest 'https://dl.google.com/chrome/install/latest/chrome_installer.exe' -OutFile $out;" ^
        "Write-Host '[INFO] 安裝中...';" ^
        "Start-Process $out -ArgumentList '/silent /install' -Wait;" ^
        "Remove-Item $out -Force -EA SilentlyContinue"
)

:: 安裝後重新偵測
for /f "delims=" %%p in ('powershell -NoProfile -Command "try{$v=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -EA Stop).'(default)';if(Test-Path $v){$v}else{''}}catch{''}"') do (
    if not "%%p"=="" set "CHROME_EXE=%%p"
)
for %%p in ("!P0!" "!P1!" "!P2!") do (
    if not defined CHROME_EXE (
        if exist %%p set "CHROME_EXE=%%~p"
    )
)
if not defined CHROME_EXE (
    echo [ERROR] Chrome 安裝後仍找不到，請關閉視窗後重新啟動本程式。
    pause
    exit /b 1
)
echo [OK] Chrome 安裝完成：!CHROME_EXE!
goto save_chrome

:chrome_pick
:: 寫暫存 PS1 開檔案選擇視窗
echo Add-Type -AssemblyName System.Windows.Forms > "%TEMP%\_pickchrome.ps1"
echo $d = New-Object System.Windows.Forms.OpenFileDialog >> "%TEMP%\_pickchrome.ps1"
echo $d.Filter = 'Chrome (chrome.exe)|chrome.exe|All Files|*.*' >> "%TEMP%\_pickchrome.ps1"
echo $d.Title = 'Select Chrome executable (chrome.exe)' >> "%TEMP%\_pickchrome.ps1"
echo $d.InitialDirectory = 'C:\Program Files' >> "%TEMP%\_pickchrome.ps1"
echo if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { '' } >> "%TEMP%\_pickchrome.ps1"

echo [INFO] 請在彈出的視窗中選擇 chrome.exe...
for /f "delims=" %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\_pickchrome.ps1"') do (
    set "CHROME_EXE=%%p"
)
del "%TEMP%\_pickchrome.ps1" >nul 2>&1

if not defined CHROME_EXE (
    echo [ERROR] 未選擇任何檔案。沒有 Chrome，公告爬取功能無法使用。
    pause
    exit /b 1
)
if not exist "!CHROME_EXE!" (
    echo [ERROR] 選擇的路徑無效：!CHROME_EXE!
    pause
    exit /b 1
)
echo [OK] 已選擇：!CHROME_EXE!

:save_chrome
:: 將路徑寫入 .env
powershell -NoProfile -Command "$p=$env:CHROME_EXE; $f='.env'; if(Test-Path $f){$c=Get-Content $f -Raw -Encoding UTF8; if($c-match'(?m)^CHROME_PATH='){$c=$c-replace'(?m)^CHROME_PATH=.*',\"CHROME_PATH=$p\"}else{$c=$c.TrimEnd()+\"`nCHROME_PATH=$p\"}}else{$c=\"CHROME_PATH=$p\"}; Set-Content $f ($c.TrimEnd()) -Encoding UTF8"
echo [INFO] Chrome 路徑已儲存至 .env，下次啟動不需重新選擇。

:chrome_ok

:: ============================================================
:: [3/4] 檢查 Port 7853
:: ============================================================
echo.
echo [3/4] 檢查 Port 7853 是否可用...
netstat -ano | findstr :7853 >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARNING] Port 7853 已被佔用，請關閉使用該 Port 的程式後重試。
    pause
    exit /b 1
)
echo [OK] Port 7853 可用。

:: ============================================================
:: [4/4] 檢查 npm 套件
:: ============================================================
echo.
echo [4/4] 檢查套件...
if not exist node_modules (
    echo [WARNING] 找不到套件資料夾（node_modules）
    echo.
    set /p CONFIRM=是否要立即安裝套件？初次安裝需要幾分鐘 [Y/n]（直接按 Enter 代表同意）：
    if "!CONFIRM!"=="" set CONFIRM=Y
    if /i "!CONFIRM!" neq "Y" (
        echo 已取消。請手動執行 npm install 後再重新啟動。
        pause
        exit /b 1
    )
    echo [INFO] 安裝中...
    call npm install --no-fund --no-audit
    if !errorlevel! neq 0 (
        echo [ERROR] npm install 失敗，請確認網路連線後重試。
        pause
        exit /b 1
    )
    echo [OK] 套件安裝完成。
) else (
    echo [OK] 套件已就緒。
)

echo.
echo ========================================================
echo   [START] 啟動後端伺服器...
echo   請保持此視窗開啟以維持系統運作
echo ========================================================
echo.

node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 程式異常停止。
    pause
)

echo.
echo 5 秒後關閉...
timeout /t 5
