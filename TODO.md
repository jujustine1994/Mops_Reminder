# TODO

## 1. 初始設定 (Resend)
- [x] 申請 Resend API Key
- [x] 填入 .env 的 `RESEND_API_KEY`
- [x] 執行網頁上的「測試寄信」，確認收件箱有收到

## 2. 本機環境優化
- [x] **自動偵測 Chrome 路徑**：目前已支援 Windows/macOS/Linux 多路徑自動掃描。
- [x] **DB 自動初始化**：程式啟動時會自動檢查並建立 `data/` 資料夾。
- [x] **網路重試機制**：已實作 3 次自動重試與指數退避邏輯。
- [x] **環境檢查腳本**：建立 `npm run check` 檢查 API Key 與 Chrome 是否到位。
- [x] **股票名稱自動抓取**：新增股票時自動同步 mopsov 公司中文名稱。

## 3. 功能擴充
- [x] **UI 優化與教學引導**：
  - [x] 實作「Resend 設定教學」彈窗。
  - [x] 03 設定區塊兩行式佈局優化。
  - [x] 介面精簡化（縮減 Header、移除歷史記錄超連結）。
  - [x] 品牌視覺強化（Logo 加大、新增 Created by CTH）。
- [ ] **精準公告直接連結** (暫緩，等爬蟲穩定後再評估)：
  - MOPS 使用 POST form 導航，個別公告無固定 GET URL
  - 需要 `seq_no` 參數，只有爬取列表時才能取得
  - crawler.js 第 228–234 行已有雛形（解析 `onclick`），但尚未驗證
  - 即使拿到 seq_no，`ajax_t05sr01` 是 AJAX 端點，不是可直接開啟的頁面
  - 目前前端已加警示 banner 告知使用者此限制
- [ ] LINE Notify 整合 (選填，比 Email 更方便)


## 4. 發布與打包
- [x] **應用程式打包**：建立 `台股公告監控雷達.bat` 並加入自動開網頁邏輯。
