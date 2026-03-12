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

### MOPS 域名 redirect 問題
- 問題：`mopsov.twse.com.tw` 回傳 `ERR_EMPTY_RESPONSE`（域名不通）
- 問題：`mops.twse.com.tw` 會 redirect，直接硬編 AJAX URL 會打到錯誤位置
- 原因：MOPS 有不定期域名調整，靜態寫死 URL 容易失效
- 解法：先用 `page.goto()` 前往首頁，再讀 `page.url()` 取得實際域名（baseOrigin），動態拼出 AJAX endpoint
- 注意：redirect 後的 AJAX URL 是否正確，仍需實際測試確認

---

### MOPS 公告無固定直接連結
- 問題：無法對單筆公告建立可點擊的超連結
- 原因：MOPS 使用 POST form 導航，個別公告需要 `seq_no` 參數，而 `seq_no` 只有爬取列表當下才能取得；`ajax_t05sr01` 是 AJAX 端點，非可直接瀏覽的頁面
- 現狀：crawler.js 第 228–234 行有解析 `onclick` 取 `seq_no` 的雛形，但尚未驗證正確性
- 解法（暫緩）：等爬蟲主功能穩定後，驗證 `onclick` 解析是否正確，再評估是否能組成可用 URL
- 前端處理：已在通知歷史區塊加警示 banner 告知使用者此限制
- 禁止：不要把 `ajax_t05sr01` 當成可直接在瀏覽器開啟的連結 URL

---

### 爬蟲跑完但 0 筆公告
- 問題：`fetchAnnouncements()` 正常執行但回傳空陣列，確認當天有公告卻抓不到
- 可能原因 1：MOPS 回傳欄位結構異動，`row0~row4` 索引對不上
- 可能原因 2：AJAX POST 參數（`co_id`、日期格式）傳錯
- 可能原因 3：Browser 沒帶 session/cookie，MOPS 擋掉請求
- 解法：在 `page.evaluate` 裡加 `console.log` 印出實際 response，對照 MOPS 網頁手動查詢結果比較欄位

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

## Email 相關

### Gmail SMTP 已棄用，改用 Resend API
- 問題：早期版本用 Nodemailer + Gmail SMTP，需要「低安全性應用程式存取」或 App Password，設定麻煩且 Google 有封鎖風險
- 解法：改用 Resend API（`resend` 套件），只需在 `.env` 設定 `RESEND_API_KEY` 與 `EMAIL_FROM`
- 禁止：不要退回 Nodemailer + Gmail SMTP 方案
