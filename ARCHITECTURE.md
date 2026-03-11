# ARCHITECTURE.md — 台股公告雷達

## 1. 專案總覽

爬取 MOPS（公開資訊觀測站）的重大訊息公告，比對使用者設定的監控股票與公告類型，發現新公告時寄 Email 通知。
架構：Node.js + Express 後端、Puppeteer 爬蟲、SQLite 儲存、Resend API 寄信、Vanilla JS 前端。

---

## 2. 檔案清單與用途

```
src/server.js        → Express 入口：掛載所有 API 路由、Log 攔截器、監聽 Port
src/db.js            → SQLite 讀寫：設定、監控股票、公告類型、歷史記錄、排程
src/crawler.js       → Puppeteer 爬蟲：爬 MOPS 公告、分類邏輯 (CATEGORY_RULES)
src/scheduler.js     → Cron 排程：定時執行 runCheck()，支援動態重設
src/mailer.js        → Resend API：寄送 HTML 格式公告通知信與測試信

public/index.html    → 唯一前端頁面（深色主題，Vanilla JS）

data/mops.db         → SQLite 資料庫（.gitignore，不進版本控制）
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
  → db.js 初始化 SQLite（建表、插入預設類型）
  → startScheduler() 從 DB 讀排程，啟動 cron jobs
  → Express 開始監聽 Port 7853
```

### 定時掃描流程
```
cron 觸發 / POST /api/run-now
  → scheduler.runCheck()
      → db.getStocks()          取監控股票清單
      → db.getTypes()           取啟用的公告類型
      → crawler.fetchAnnouncements(code, fromDate, toDate)  爬蟲抓公告
          → Puppeteer 開 Chrome → 前往 MOPS → 送 AJAX POST 查詢
          → crawler.classifyType(title)  用 CATEGORY_RULES 打標籤
      → db.isNotified()         過濾已通知過的公告
      → db.addHistory()         寫入歷史記錄
      → mailer.sendNotification()  寄 Email（Resend API）
```

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
DELETE /api/history             清空歷史記錄

POST   /api/run-now             立即執行一次完整掃描
POST   /api/test-email          寄測試信到指定 Email

GET    /api/logs                取後端 console log（最近 100 筆）
```

---

## 5. 資料庫結構（SQLite: data/mops.db）

```
config              → key/value 設定（email、checkDays、schedules）
watched_stocks      → 監控股票（code, name）
stock_ref           → 股票名稱對照表（code, name），自動學習，優先級最高
announcement_types  → 公告類型與啟用狀態（id, label, enabled）
history             → 已通知記錄（防重複）：(stock_code, title, ann_date) 唯一索引
```

---

## 6. 重要設定與環境變數

```
PORT             → server Port（預設 7853）
RESEND_API_KEY   → Resend 寄信 API Key（必填）
EMAIL_FROM       → 發信人地址（預設 onboarding@resend.dev）
```

---

## 7. 分類規則維護

**唯一維護點：`src/crawler.js` 的 `CATEGORY_RULES` 陣列（約第 70 行）**
新增/修改分類只需改這一個地方，前端說明彈窗（`GET /api/categories`）與 Email 標籤會自動同步。
詳細維護說明見 `CATEGORY_RULES` 上方的區塊註解。

