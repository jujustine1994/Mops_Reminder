# TODO

> 只列尚未完成的工作；已完成功能與修改原因見 `ARCHITECTURE.md`、`CHANGELOG.md`。

1. **新公告預先儲存詳情**：目前排程只寫通知歷史，首次點主旨仍需連線 MOPS。評估在掃描時安全地填入 `announcement_details`，並控制查詢頻率與失敗重試，讓網頁首次開啟也能本機讀取。
2. **Email 使用公告詳情**：決定在信內直接放完整「說明」，或提供可從外部開啟的詳情頁；移除舊 `ajax_t05sr01` 連結，處理 HTML 跳脫與長內容排版，並以不寄真信的方式驗證。`localhost` 網址不能供其他裝置開啟。
3. **寄送狀態與重試**：目前 `scheduler.js` 先寫 `history` 再寄信，寄送失敗會被防重複機制視為已處理。設計「已發現／已寄達」狀態後再修改，避免漏寄或重寄。
4. **統一公告來源**：評估讓排程掃描改用新版 MOPS API，減少舊 Puppeteer 列表與新版詳情 API 並存；切換前需驗證上市、上櫃、公開發行、跨月、分類與去重行為。
5. **文件位置**：目前 `ARCHITECTURE.md`、`CHANGELOG.md`、`PITFALLS.md`、`TODO.md` 仍在專案根目錄。若依新模板搬至 `docs/`，先列搬移清單並更新 README 與程式內路徑引用。
6. **其他通知管道（選做）**：若仍需要 LINE 通知，評估 LINE Messaging API。原待辦的 LINE Notify 已於 2025-03-31 結束服務，不能再作為實作目標；見 [LINE 官方公告](https://developers.line.biz/en/news/2025/04/01/line-notify/)。
