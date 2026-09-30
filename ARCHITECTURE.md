# ARCHITECTURE.md — 台股公告雷達

## 1. 專案總覽與現狀

本機 Node.js 工具：監控 MOPS 重大訊息，依股票與公告類型篩選，記錄通知歷史，並可用 Resend 寄 Email。網頁介面由 Express 提供，SQLite 儲存個人資料。

**已完成功能：**
- 排程與「立即檢查」仍使用 `src/crawler.js` 的舊版 MOPS 頁面爬蟲，並由 `src/scheduler.js` 篩選、寫入 `history`、寄信。
- 通知歷史主旨可在本機網頁開啟詳情；`src/history-detail.js` 優先讀 `announcement_details`，未命中才用新版 MOPS API 查詢並快取。
- `src/fetch-announcement-details.js` 可獨立擷取詳情，不會執行排程或寄信。

**尚未完成：** 郵件仍使用舊爬蟲產生的無效公告連結，尚未包含已擷取的「說明」；其他待辦見 `TODO.md`。

---

## 2. 檔案清單與用途

```
src/server.js        → Express 入口：掛載所有 API 路由、Log 攔截器、監聽 Port
src/db.js            → SQLite 讀寫：設定、監控股票、公告類型、歷史記錄、排程
src/crawler.js       → Puppeteer 爬蟲：爬 MOPS 公告、分類邏輯 (CATEGORY_RULES)
src/mops-details.js  → 新版 MOPS 歷史公告列表及單筆詳情 API（第一階段）
src/announcement-details-db.js → 公告詳情獨立資料表與讀寫（第一階段）
src/fetch-announcement-details.js → 手動擷取指令，不啟動排程或寄信（第一階段）
src/history-detail.js → 通知紀錄對應公告詳情；先讀本機快取，缺少時查 MOPS
src/scheduler.js     → Cron 排程：定時執行 runCheck()，支援動態重設
src/mailer.js        → Resend API：寄送 HTML 格式公告通知信與測試信

public/index.html    → 唯一前端頁面（深色主題，Vanilla JS）

data/mops.db         → 個人設定、通知歷史、公告詳情（.gitignore，不進版本控制）
data/stock_ref.db    → 公開股票代號與名稱對照表（進版本控制）
.env                 → 環境變數（.gitignore，不進版本控制）
.env.example         → 環境變數範本（進版本控制）
台股公告監控雷達.bat  → 薄殼啟動器：只負責呼叫 launcher.ps1
launcher.ps1          → 環境檢查、首次安裝說明、啟動後端伺服器
```

---

## 3. 模組串接與資料流

### 啟動流程
```
server.js 啟動
  → db.js 初始化 SQLite（建表、新增缺少的預設類型；保留使用者的啟用狀態）
  → startScheduler() 從 DB 讀排程，啟動 cron jobs
  → Express 開始監聽 Port 7853
  → child_process.exec 自動開啟瀏覽器至 http://localhost:7853
```

### 定時掃描流程
```
cron 觸發 / POST /api/run-now
  → scheduler.runCheck()  （isRunning 鎖，防止多次重疊執行）
      → db.getStocks()          取監控股票清單
      → db.getTypes()           取啟用的公告類型
      → crawler.fetchAnnouncements(code, fromDate, toDate)  爬蟲抓公告
          → Puppeteer 開 Chrome
          → 前往 mopsov.twse.com.tw/mops/web/t05st01（舊版頁面）
          → 填入表單（co_id、year、month）→ 點查詢按鈕
          → 等待結果表格出現 → 解析 HTML（cheerio）
          → crawler.classifyType(title)  回傳 string[]（多標籤）
      → 用 some() 比對 ann.type[] 與 enabledTypes[]，過濾不符合類型的公告
      → db.isNotified()         過濾已通知過的公告
      → db.addHistory()         寫入歷史記錄
      → mailer.sendNotification()  寄 Email（Resend API；目前仍使用舊連結）
```

### 公告詳情擷取流程（第一階段，尚未接入寄信）
```
node src/fetch-announcement-details.js --stock 2330 --from 2026-09-01 --to 2026-09-01
  → POST MOPS /mops/api/t05st01 查列表
  → 使用列表返回的 apiName 與 parameters，POST /mops/api/t05st01_detail
  → 解析完整「說明」與其他欄位
  → announcement_details 表以市場別、公司、發言日期、序號作來源唯一鍵保存
```
此指令不呼叫 `scheduler.runCheck()`，也不載入 `mailer.js`。可加 `--db data/測試.db` 使用獨立資料庫。

### 網頁查看公告詳情
```
通知歷史點主旨 → GET /api/history/:id/detail
  → 以股票、日期、主旨、時間比對 announcement_details 快取
  → 若尚未保存，向 MOPS 查詢並存入快取
  → 回傳完整說明，在網頁詳情視窗顯示
```
對應結果不唯一時回傳錯誤，避免顯示錯誤公告；此流程不寄信。每筆公告首次快取未命中時，需依序查 MOPS 列表與詳情兩個 API，速度取決於對方與網路；成功保存後再次開啟直接讀 SQLite。排程掃描只寫 `history`，不會自動填入 `announcement_details`；手動擷取可提前填入快取。

瀏覽器只呼叫本機 `/api/history/:id/detail`，不會跳轉到 MOPS 公告網址。後端先以公司和日期 POST 查列表，再使用列表回傳的市場別、公司代號、日期及序號 POST 查單筆詳情；這些識別參數不能只靠舊版連結猜出。

### 排程更新流程（即時生效，不需重啟）
```
前端儲存設定 → POST /api/config { schedules: [...] }
  → db.setSchedules()
  → scheduler.applySchedules()  停掉舊 cron jobs → 建新 cron jobs
```

---

## 4. API 路由一覽

```
GET    /api/config              取得所有設定（email、stocks、types、schedules、checkDays）
POST   /api/config              儲存設定（支援局部更新，schedules 立即套用）

GET    /api/stock-name/:code    查股票名稱（先查 DB，沒有才爬蟲）
POST   /api/stocks              新增監控股票
DELETE /api/stocks/:code        刪除監控股票

PATCH  /api/types/:id           更新單一公告類型的啟用狀態

GET    /api/categories          取得 CATEGORY_RULES（前端說明彈窗用）

GET    /api/history             取歷史通知記錄（?limit=N，預設 100）
GET    /api/history/:id/detail  取單筆公告詳情（本機優先，必要時查 MOPS）
DELETE /api/history             清空歷史記錄與公告詳情快取（同一 transaction）
DELETE /api/history?preserveDetails=1  只清歷史記錄，供「立即檢查」重新掃描

POST   /api/run-now             立即執行一次完整掃描
POST   /api/test-email          寄測試信到指定 Email

GET    /api/logs                取後端 console log（最近 100 筆）
```

---

## 5. 資料庫結構

`data/mops.db`（個人資料，不進版本控制）：
```
config              → key/value 設定（email、checkDays、schedules）
watched_stocks      → 監控股票（code, name）
announcement_types  → 公告類型與啟用狀態（id, label, enabled）
history             → 已通知記錄（防重複）：(stock_code, title, ann_date) 唯一索引
announcement_details → 擷取的完整公告內容；與通知歷史分開，source_id 為來源唯一鍵
```

公告內文快取只存於既有 `data/mops.db` 的 `announcement_details` 表，不建立每筆公告的文字檔或額外快取資料夾。網頁「清除紀錄與快取」會在同一 SQLite transaction 清空 `history` 與 `announcement_details`，保留設定和股票清單；「立即檢查」只清 `history`。

`data/stock_ref.db`（公開對照表，隨版本發布）：`stock_ref(code, name)`。新股票名稱會自動補入此檔。

---

## 6. 重要設定與環境變數

```
PORT             → server Port（預設 7853）
RESEND_API_KEY   → Resend 寄信 API Key（寄信時必填）
EMAIL_FROM       → 發信人地址（預設 onboarding@resend.dev）
CHROME_PATH      → 舊版爬蟲所用的 Chrome 路徑；通常可自動偵測
```

---

## 7. 分類規則維護

**唯一維護點：`src/crawler.js` 的 `CATEGORY_RULES` 陣列（約第 70 行）**
新增/修改分類只需改這一個地方，前端說明彈窗（`GET /api/categories`）與 Email 標籤會自動同步。
詳細維護說明見 `CATEGORY_RULES` 上方的區塊註解。

## 8. 接手修改時的界線

- **公告分類：** 改 `src/crawler.js` 的 `CATEGORY_RULES`，並確認資料庫類型 ID 與 UI 說明仍相符。
- **舊版掃描與通知：** `crawler.js` → `scheduler.js` → `db.js` / `mailer.js`。目前 `crawler.js` 拼出的 `ajax_t05sr01` 不是可直接開啟的網址；不要把它重新接回 UI。
- **網頁詳情：** `mops-details.js` → `history-detail.js` → `announcement-details-db.js` → `GET /api/history/:id/detail` → `public/index.html`。官方識別鍵由市場別、公司代號、日期、序號組成，不應只靠公告標題識別。
- **郵件下一階段：** 先決定如何取得與呈現完整說明，再修改 `mailer.js`；測試時不得寄到真實收件人。
- **資料安全：** `data/mops.db`、`.env` 是本機個人資料，測試擷取請用 `--db data/測試.db`。`data/stock_ref.db` 是公開對照表，需隨版本發布。

## 9. 郵件提醒與摘要的下一階段設計（尚未實作）

### 目前能做到的事與限制

- 本機 `node-cron` 在程式運行期間觸發 `scheduler.runCheck()`，再由 `mailer.js` 呼叫 Resend 寄信；不需對外開放本機網頁，但掃描、寄信都需要網路，關閉程式就沒有排程。
- 現有 `CATEGORY_RULES` 只根據**標題**分類，使用者可啟用類型來篩選郵件。這是「主題類別」，不等同某筆公告對該使用者的財務重要程度；`major` 只是未命中其他關鍵字的保底分類。
- 現有信件批次寄送標題、日期、類型與舊連結；沒有附上已擷取的「說明」。`history` 在寄信前寫入，失敗後可能不會重寄。

### 建議實作順序

1. **可靠寄送**：先把公告發現、詳情擷取、待寄、寄送成功／失敗分開記錄。使用來源唯一鍵去重；失敗可重試，避免把「寫入歷史」誤當「已寄達」。信件放公告原始內文或足夠的原文節錄，移除無效連結；寄信內容做 HTML 跳脫。
2. **使用者定義的優先提醒**：保留現有股票與類型篩選；另加可編輯的優先類型／關鍵字條件，先提供「全部符合條件寄送」與「僅優先條件即時寄送」等明確模式。一般公告可彙整寄送，優先公告單獨寄送。條件命中理由顯示在網頁及郵件中，避免把系統判斷寫成投資結論。
3. **可選 AI 摘要**：只對已取得完整內文、且準備寄送的公告摘要；輸出例如「事件、關鍵數字／日期、尚待確認事項」的固定欄位，附上原始公告文字供核對。摘要失敗時照常寄原文，模型不單獨決定要不要通知，也不輸出買賣建議。雲端模型需額外 API Key、網路與費用，並會把公告文字送到服務商；本機模型可避免這一步，但需另評估安裝、效能與維護負擔。

「重要」應是使用者自訂的提醒優先度，而非把 MOPS 的法規「重大訊息」或目前的 `major` 分類直接當成投資重要性。法規公告範圍可參考[臺灣證券交易所重大訊息處理程序第 4 條](https://twse-regulation.twse.com.tw/TW/law/DAT0202_print.aspx?FLCODE=FL007111&LCC=2&LCNOS=+++4+++)；詳細實作工作見 `TODO.md`。

