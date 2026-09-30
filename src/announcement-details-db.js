// 保存新版 MOPS 公告詳細內容；與既有通知歷史分開，擷取時不會觸發寄信。
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'mops.db');

/** 以官方的市場別、公司、日期和序號識別公告，避免只靠標題去重。 */
function sourceId(announcement) {
  const p = announcement.parameters;
  return [p.marketKind, p.companyId, p.enterDate, p.serialNumber].map(String).join(':');
}

/** 開啟公告詳情資料表；可傳入獨立測試資料庫路徑。 */
function openDetailsDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcement_details (
      source_id TEXT PRIMARY KEY,
      stock_code TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      ann_date TEXT NOT NULL,
      ann_time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      api_name TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      detail_text TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_announcement_details_stock_date
      ON announcement_details (stock_code, ann_date);
  `);
  const upsert = db.prepare(`
    INSERT INTO announcement_details
      (source_id, stock_code, company_name, ann_date, ann_time, title,
       api_name, parameters_json, detail_text, fields_json, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      stock_code = excluded.stock_code,
      company_name = excluded.company_name,
      ann_date = excluded.ann_date,
      ann_time = excluded.ann_time,
      title = excluded.title,
      parameters_json = excluded.parameters_json,
      detail_text = excluded.detail_text,
      fields_json = excluded.fields_json,
      detail_json = excluded.detail_json,
      fetched_at = datetime('now', 'localtime')
  `);

  return {
    save(announcement) {
      upsert.run(
        sourceId(announcement), announcement.stockCode, announcement.companyName,
        announcement.annDate, announcement.annTime, announcement.title,
        announcement.apiName, JSON.stringify(announcement.parameters),
        announcement.detailText, JSON.stringify(announcement.fields),
        JSON.stringify(announcement.detailPayload)
      );
    },
    get(id) {
      return db.prepare('SELECT * FROM announcement_details WHERE source_id = ?').get(id);
    },
    findByStockDate(stockCode, annDate) {
      return db.prepare('SELECT * FROM announcement_details WHERE stock_code = ? AND ann_date = ?')
        .all(stockCode, annDate);
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS count FROM announcement_details').get().count;
    },
    close() { db.close(); },
  };
}

module.exports = { openDetailsDb, sourceId, DEFAULT_DB_PATH };
