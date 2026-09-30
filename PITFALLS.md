# PITFALLS.md — 已知問題與解決方案

## 爬蟲相關

### puppeteer vs puppeteer-core
- 問題：`puppeteer` 套件會自動下載 Chromium，在 Windows 環境常因路徑或權限失敗
- 原因：自帶 Chromium 路徑與本機 Chrome 衝突，且下載常超時
- 解法：改用 `puppeteer-core`，手動指定本機 Chrome 路徑
  ```js
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ```
- 禁止：不要用 `puppeteer`（完整版），也不要嘗試讓它自動下載 Chromium

---

### 兩套 MOPS 流程不可混用
- 現狀：排程通知仍由 `crawler.js` 操作 `mopsov.twse.com.tw` 舊版歷史頁；網頁公告詳情由 `mops-details.js` 查 `mops.twse.com.tw/mops/api/` 新版 API。
- 新版列表 `POST t05st01` 回傳每筆 `apiName` 與 `parameters`；詳情使用這組原始參數 `POST t05st01_detail`。市場別與序號不可從股票代號或標題自行猜測。
- 新版 API 屬網站內部介面，可能隨 MOPS 改版；改動後應用已知股票與日期驗證「列表 → 詳情」，並用獨立測試 DB，不要觸發寄信。
- 列表回應 `code=406, message=查無相符資料` 代表零筆；其他異常不可當成零筆吞掉。

---

### scheduler.js 類型過濾：ann.type 是 array，不能用 includes()
- **問題**：若把「其他重大訊息（major）」停用，其他有勾的類型也全部失效，公告一筆都進不來
- **原因**：`classifyType()` 回傳 `string[]`（多標籤），但舊寫法用 `enabledTypes.includes(ann.type)` 把整個 array 當 string 比對，永遠是 false
- **解法**：改用 `ann.type.some(t => enabledTypes.includes(t))`（已修正於 2026-03-12）
- **禁止**：不要在比對 ann.type 時用 `===` 或 `includes(ann.type)`

---

### MOPS 公告無固定直接連結
- 問題：舊爬蟲產生的 `ajax_t05sr01` 是 AJAX 端點，不是能直接放入 Email 的公告網頁網址。
- 現狀：網頁通知歷史已改為本機詳情視窗；首次開啟舊紀錄時查 MOPS 並快取到 `announcement_details`。Email 仍使用舊連結，待下一階段處理。
- 禁止：不要把 `ajax_t05sr01` 當成瀏覽器連結，也不要把 `localhost` 連結寄給需要在其他裝置開啟的使用者。

---

### 爬蟲跑完但 0 筆公告
- 問題：`fetchAnnouncements()` 正常執行但回傳空陣列，確認當天有公告卻抓不到
- 可能原因：舊版頁面的輸入欄位、查詢按鈕或表格欄序變更；或查詢月份、民國日期解析錯誤。
- 先用手動查詢與 `src/fetch-announcement-details.js` 的新版 API 結果對照，再定位是舊爬蟲頁面操作還是日期過濾問題。
- `fetchAnnouncements()` 重試耗盡會回傳空陣列；不能只靠「零筆」判斷市場真的沒有公告。

---

### 分類啟用狀態不能用 REPLACE 初始化
- `announcement_types` 的 `enabled` 是使用者設定。`INSERT OR REPLACE` 更新標籤會刪除舊列並以預設 `enabled=1` 重建。
- 只更新標籤時使用 `ON CONFLICT(id) DO UPDATE SET label=excluded.label`，保留啟用狀態。

---

### 寄信失敗後的通知歷史
- 目前 `scheduler.js` 會先寫入 `history`，再呼叫 Resend；寄信失敗時紀錄仍會保留，下次掃描因防重複不會重寄。
- 修改寄信流程前須先決定「已發現」與「已寄送」的狀態如何區分，避免誤把已記錄視為已寄達。

---

## 排程相關

### node-cron task.destroy() 不存在
- 問題：呼叫 `task.destroy()` 時報錯 `TypeError: t.destroy is not a function`
- 原因：node-cron 的 task 物件沒有 `destroy()` 方法
- 解法：改用 `task.stop()`
- 禁止：不要用 `destroy()`、`kill()`、`remove()`

---

## 套件管理

### 使用 pnpm，不要用 npm
- 問題：混用 npm 與 pnpm 會產生兩份 lock file（`package-lock.json` + `pnpm-lock.yaml`），造成依賴衝突
- 解法：統一用 `pnpm install` 安裝套件，`pnpm start` 啟動
- 禁止：不要執行 `npm install`，會產生 `package-lock.json` 污染專案

---

### pnpm 不接受 npm 專屬旗標（--no-fund、--no-audit）
- 問題：執行 `pnpm install --no-fund --no-audit` 報 `Unknown options: 'fund', 'audit'` 並中斷
- 原因：`--no-fund` / `--no-audit` 是 npm 的旗標，pnpm 不認識
- 解法：直接用 `pnpm install`，不要帶這兩個參數
- 禁止：不要把 npm 的 CLI 旗標複製貼上到 pnpm 指令

---

## 啟動器相關

### PowerShell PS1 檔案中文亂碼閃退
- 問題：launcher.ps1 包含中文，雙擊 bat 後視窗閃退，錯誤訊息顯示「陣列索引運算式遺失」或「字串遺漏結尾字元」
- 原因：Write 工具存出 UTF-8 without BOM，Windows PowerShell 5.x 用系統預設編碼（CP950）讀取，中文 bytes 被誤解析成語法錯誤
- 解法：用 PowerShell 將 PS1 重新存成 UTF-8 with BOM：
  ```powershell
  $content = Get-Content 'launcher.ps1' -Raw -Encoding UTF8
  [System.IO.File]::WriteAllText('launcher.ps1', $content, [System.Text.UTF8Encoding]::new($true))
  ```
- 禁止：不要在 PS1 裡放中文後直接使用 Write 工具存檔，必須補加 BOM

---

### Node.js 已安裝但啟動器仍提示重新安裝（PATH 未刷新）
- 問題：Node.js 已安裝，啟動器卻顯示「未偵測到 Node.js」並詢問是否安裝
- 原因：BAT 以 `powershell -NoProfile` 呼叫 PS1，在某些情況下 session 的 `$env:PATH` 尚未包含 Node.js 目錄，導致 `Get-Command node` 找不到
- 解法：偵測前先執行 `$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + ...User`，刷新後再找；仍找不到才搜尋常見安裝路徑（`C:\Program Files\nodejs\node.exe` 等）
- 禁止：不要只靠 `Get-Command node` 單一判斷，PATH 可能因啟動方式不同而不完整

---

### winget 安裝 Node.js 靜默失敗 → 無限重新安裝循環
- 問題：使用者安裝完 Node.js 後重開機，啟動器還是說找不到 Node.js，一直重複安裝
- 原因：winget 在 ARM64 Parallels 虛擬機上靜默失敗（exit code 非 0），舊版程式未檢查 `$LASTEXITCODE`，直接繼續執行，結果什麼都沒裝成
- 解法：winget 後加 `$LASTEXITCODE` 檢查，失敗就 fallback 到直接下載 MSI（MSI 路徑已有 ARM64 架構偵測）
- 禁止：不要假設 winget `--silent` 一定成功，必須檢查 exit code

---

## Email 相關

### Gmail SMTP 已棄用，改用 Resend API
- 問題：早期版本用 Nodemailer + Gmail SMTP，需要「低安全性應用程式存取」或 App Password，設定麻煩且 Google 有封鎖風險
- 解法：改用 Resend API（`resend` 套件），只需在 `.env` 設定 `RESEND_API_KEY` 與 `EMAIL_FROM`
- `nodemailer` 已從依賴移除；勿在新功能中重新加入 SMTP 寄信。
- 禁止：不要退回 Nodemailer + Gmail SMTP 方案
