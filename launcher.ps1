# 台股公告雷達 啟動器
# 負責環境檢查、首次安裝說明、啟動後端伺服器

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = "TWSTOCK RADAR - Created by CTH"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Clear-Host
Write-Host "[INFO] Starting TWSTOCK RADAR..." -ForegroundColor Green
Write-Host ""

# ======================================
# [1/4] 檢查 Node.js
# ======================================
Write-Host "[1/4] 檢查 Node.js 環境..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[WARNING] 未偵測到 Node.js，本程式需要 Node.js 才能執行。" -ForegroundColor Yellow
    $ans = Read-Host "是否要立即安裝 Node.js？[Y/n] - 直接按 Enter 代表同意"
    if ($ans -eq "" -or $ans -ieq "Y") {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Write-Host "[INFO] 使用 winget 安裝 Node.js LTS，請稍候..." -ForegroundColor Gray
            winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
        } else {
            Write-Host "[INFO] 正在下載 Node.js 安裝程式，請稍候..." -ForegroundColor Gray
            $ver = ((Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1).version
            $url = "https://nodejs.org/dist/$ver/node-$ver-x64.msi"
            $out = "$env:TEMP\node_lts.msi"
            Write-Host "[INFO] 下載 $url ..." -ForegroundColor Gray
            Invoke-WebRequest $url -OutFile $out
            Write-Host "[INFO] 安裝中..." -ForegroundColor Gray
            Start-Process msiexec.exe -ArgumentList "/i $out /quiet /norestart" -Wait
            Remove-Item $out -Force -ErrorAction SilentlyContinue
        }
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Host ""
            Write-Host "[INFO] 安裝完成！請關閉此視窗，再次點兩下啟動檔重新啟動。" -ForegroundColor Yellow
            Read-Host "按 Enter 關閉"; exit 0
        }
        Write-Host "[OK] Node.js 安裝完成。" -ForegroundColor Green
    } else {
        Write-Host "已取消。請安裝 Node.js 後重新啟動。" -ForegroundColor Gray
        Read-Host "按 Enter 關閉"; exit 1
    }
} else {
    $nodeVer = node -v
    Write-Host "[OK] Node.js $nodeVer 已安裝。" -ForegroundColor Green
}

# ======================================
# 建立 .env（若不存在）
# ======================================
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[OK] 已自動建立 .env 設定檔。" -ForegroundColor Green
}

# ======================================
# [2/4] 檢查 Google Chrome
# ======================================
Write-Host ""
Write-Host "[2/4] 檢查 Google Chrome 瀏覽器..." -ForegroundColor Cyan

function Find-ChromePath {
    # 先讀 .env 已儲存的路徑
    if (Test-Path ".env") {
        $saved = (Get-Content ".env" -Encoding UTF8 | Where-Object { $_ -match "^CHROME_PATH=(.+)" })
        if ($saved) {
            $path = $saved -replace "^CHROME_PATH=", ""
            if (Test-Path $path) { return $path }
        }
    }
    # 查 Registry
    try {
        $reg = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction Stop).'(default)'
        if (Test-Path $reg) { return $reg }
    } catch {}
    # 常見路徑
    @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | ForEach-Object { if (Test-Path $_) { return $_ } }
    return $null
}

function Save-ChromePath($path) {
    $f = ".env"
    $content = if (Test-Path $f) { Get-Content $f -Raw -Encoding UTF8 } else { "" }
    if ($content -match "(?m)^CHROME_PATH=") {
        $content = $content -replace "(?m)^CHROME_PATH=.*", "CHROME_PATH=$path"
    } else {
        $content = $content.TrimEnd() + "`nCHROME_PATH=$path"
    }
    Set-Content $f ($content.TrimEnd()) -Encoding UTF8
}

$chromeExe = Find-ChromePath
if ($chromeExe) {
    Write-Host "[OK] 找到 Chrome：$chromeExe" -ForegroundColor Green
    Save-ChromePath $chromeExe
    Write-Host "[INFO] Chrome 路徑已儲存至 .env。" -ForegroundColor Gray
} else {
    Write-Host "[WARNING] 找不到 Google Chrome。" -ForegroundColor Yellow
    Write-Host ""
    $hasChrome = Read-Host "您的電腦上是否已有安裝 Google Chrome？[Y/n]"
    if ($hasChrome -eq "" -or $hasChrome -ieq "Y") {
        Write-Host ""
        Write-Host "  Chrome 可能安裝在非標準位置，請在接下來的視窗中手動選擇 chrome.exe。" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "按 Enter 開啟檔案選擇視窗"
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Filter = "Chrome (chrome.exe)|chrome.exe|All Files|*.*"
        $dialog.Title = "選擇 Chrome 執行檔 (chrome.exe)"
        $dialog.InitialDirectory = "C:\Program Files"
        if ($dialog.ShowDialog() -eq "OK" -and (Test-Path $dialog.FileName)) {
            $chromeExe = $dialog.FileName
            Write-Host "[OK] 已選擇：$chromeExe" -ForegroundColor Green
            Save-ChromePath $chromeExe
            Write-Host "[INFO] Chrome 路徑已儲存至 .env，下次啟動不需重新選擇。" -ForegroundColor Gray
        } else {
            Write-Host "[ERROR] 未選擇有效的 Chrome 路徑，公告爬取功能無法使用。" -ForegroundColor Red
            Read-Host "按 Enter 關閉"; exit 1
        }
    } else {
        $installChrome = Read-Host "是否要立即安裝 Google Chrome？[Y/n] - 直接按 Enter 代表同意"
        if ($installChrome -eq "" -or $installChrome -ieq "Y") {
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                Write-Host "[INFO] 使用 winget 安裝 Google Chrome，請稍候..." -ForegroundColor Gray
                winget install --id Google.Chrome -e --silent --accept-source-agreements --accept-package-agreements
            } else {
                Write-Host "[INFO] 正在下載 Google Chrome 安裝程式，請稍候..." -ForegroundColor Gray
                $out = "$env:TEMP\chrome_installer.exe"
                Invoke-WebRequest 'https://dl.google.com/chrome/install/latest/chrome_installer.exe' -OutFile $out
                Write-Host "[INFO] 安裝中..." -ForegroundColor Gray
                Start-Process $out -ArgumentList "/silent /install" -Wait
                Remove-Item $out -Force -ErrorAction SilentlyContinue
            }
            $chromeExe = Find-ChromePath
            if (-not $chromeExe) {
                Write-Host "[ERROR] Chrome 安裝後仍找不到，請關閉視窗後重新啟動本程式。" -ForegroundColor Red
                Read-Host "按 Enter 關閉"; exit 1
            }
            Write-Host "[OK] Chrome 安裝完成：$chromeExe" -ForegroundColor Green
            Save-ChromePath $chromeExe
        } else {
            Write-Host "[ERROR] 沒有 Chrome，公告爬取功能無法使用。請安裝後重新啟動。" -ForegroundColor Red
            Read-Host "按 Enter 關閉"; exit 1
        }
    }
}

# ======================================
# [3/4] 檢查 Port 7853
# ======================================
Write-Host ""
Write-Host "[3/4] 檢查 Port 7853 是否可用..." -ForegroundColor Cyan
$portInUse = Get-NetTCPConnection -LocalPort 7853 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "[WARNING] Port 7853 已被其他程式佔用，請關閉後重試。" -ForegroundColor Yellow
    Read-Host "按 Enter 關閉"; exit 1
}
Write-Host "[OK] Port 7853 可用。" -ForegroundColor Green

# ======================================
# [4/4] 檢查 pnpm 套件
# ======================================
Write-Host ""
Write-Host "[4/4] 檢查套件..." -ForegroundColor Cyan
if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Cyan
    Write-Host "    台股公告雷達 - 首次安裝說明" -ForegroundColor Cyan
    Write-Host "  ============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  接下來程式會自動幫你安裝以下東西：" -ForegroundColor White
    Write-Host ""
    Write-Host "    node_modules（Node.js 套件）" -ForegroundColor Yellow
    Write-Host "    爬蟲、資料庫、Email 通知等功能的核心元件" -ForegroundColor Gray
    Write-Host "    安裝完成後，之後啟動不需要重複安裝" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  全程只需要一直按 Enter 同意即可。" -ForegroundColor Green
    Write-Host "  如果有任何疑問，可以把這段說明貼給 AI 詢問。" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Cyan
    Write-Host ""
    $ans = Read-Host "[WARNING] 找不到套件資料夾，是否要立即安裝？初次安裝需要幾分鐘 [Y/n] - 直接按 Enter 代表同意"
    if ($ans -eq "" -or $ans -ieq "Y") {
        Write-Host "[INFO] 安裝中..." -ForegroundColor Gray
        & pnpm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] pnpm install 失敗，請確認網路連線後重試。" -ForegroundColor Red
            Read-Host "按 Enter 關閉"; exit 1
        }
        Write-Host "[OK] 套件安裝完成。" -ForegroundColor Green
    } else {
        Write-Host "已取消。請手動執行 pnpm install 後再重新啟動。" -ForegroundColor Gray
        Read-Host "按 Enter 關閉"; exit 1
    }
} else {
    Write-Host "[OK] 套件已就緒。" -ForegroundColor Green
}

# ======================================
# 啟動後端伺服器
# ======================================
Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host "    [START] 啟動後端伺服器..." -ForegroundColor Green
Write-Host "    請保持此視窗開啟以維持系統運作" -ForegroundColor Green
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host ""

node src/server.js
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 程式異常停止。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
} else {
    Write-Host ""
    Write-Host "5 秒後關閉..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
}
