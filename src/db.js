const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'mops.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS watched_stocks (
    code TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS stock_ref (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcement_types (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    stock_name TEXT DEFAULT '',
    title TEXT NOT NULL,
    ann_date TEXT NOT NULL,
    ann_time TEXT DEFAULT '',
    link TEXT DEFAULT '',
    type TEXT DEFAULT '',
    notified_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(stock_code, title, ann_date)
  );
`);

// 預設公告類型
const defaultTypes = [
  { id: 'major', label: '其他重大訊息' },
  { id: 'financial', label: '財務報告' },
  { id: 'dividend', label: '股利公告' },
  { id: 'meeting', label: '重要會議' },
  { id: 'earnings', label: '法說會' },
  { id: 'capital_change', label: '股本變動' },
  { id: 'merger', label: '合併/收購' },
  { id: 'board', label: '董監事異動' },
  { id: 'clarify', label: '報導相關' },
  { id: 'asset_disposal', label: '處分資產' },
];

// 清除舊的類型並新增/更新類型
['other', 'capital', 'buyback'].forEach(id => {
  db.prepare('DELETE FROM announcement_types WHERE id = ?').run(id);
});
const insertType = db.prepare(`INSERT OR REPLACE INTO announcement_types (id, label) VALUES (?, ?)`);
for (const t of defaultTypes) insertType.run(t.id, t.label);

// ---- Config ----
function getConfig(key, fallback = null) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

// ---- Stocks ----
function getStocks() {
  // 使用 COALESCE 優先取對照表 (stock_ref) 的名字，若無才用原本監控表的名字
  return db.prepare(`
    SELECT w.code, COALESCE(r.name, w.name) as name, w.created_at
    FROM watched_stocks w
    LEFT JOIN stock_ref r ON w.code = r.code
    ORDER BY w.code
  `).all();
}

function findStockName(code) {
  code = code.trim();
  // 1. 先從對照表找 (最優先，官方清單)
  const ref = db.prepare('SELECT name FROM stock_ref WHERE code = ?').get(code);
  if (ref && ref.name) return ref.name;

  // 2. 再從監控清單找
  const watched = db.prepare('SELECT name FROM watched_stocks WHERE code = ?').get(code);
  if (watched && watched.name) return watched.name;

  // 3. 最後從歷史記錄找
  const history = db.prepare('SELECT stock_name FROM history WHERE stock_code = ? ORDER BY notified_at DESC LIMIT 1').get(code);
  if (history && history.stock_name) return history.stock_name;

  return null;
}

function upsertStockRef(stockList) {
  const insert = db.prepare('INSERT OR REPLACE INTO stock_ref (code, name) VALUES (?, ?)');
  const transaction = db.transaction((list) => {
    for (const s of list) {
      if (s.code && s.name) insert.run(String(s.code).trim(), String(s.name).trim());
    }
  });
  transaction(stockList);
  return stockList.length;
}

function addStock(code, name = '') {
  db.prepare('INSERT OR REPLACE INTO watched_stocks (code, name) VALUES (?, ?)').run(code.trim(), name.trim());
}

function removeStock(code) {
  db.prepare('DELETE FROM watched_stocks WHERE code = ?').run(code);
}

// ---- Announcement Types ----
function getTypes() {
  return db.prepare('SELECT * FROM announcement_types ORDER BY id').all();
}

function setTypeEnabled(id, enabled) {
  db.prepare('UPDATE announcement_types SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

// ---- History ----
function isNotified(stockCode, title, annDate) {
  return !!db.prepare('SELECT 1 FROM history WHERE stock_code=? AND title=? AND ann_date=?')
    .get(stockCode, title, annDate);
}

function addHistory(item) {
  try {
    // 確保 type 永遠是 JSON 陣列字串 (例如 ["dividend", "meeting"])
    let typeData = item.type || ['major'];
    if (typeof typeData === 'string') {
      try { typeData = JSON.parse(typeData); } catch(e) { typeData = [typeData]; }
    }
    const typeStr = JSON.stringify(Array.isArray(typeData) ? typeData : [typeData]);

    db.prepare(`INSERT OR IGNORE INTO history (stock_code, stock_name, title, ann_date, ann_time, link, type)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      item.stockCode, item.stockName, item.title, item.annDate, item.annTime || '', item.link || '', typeStr
    );
  } catch (e) { /* duplicate, ignore */ }
}

function getHistory(limit = 100) {
  return db.prepare('SELECT * FROM history ORDER BY notified_at DESC LIMIT ?').all(limit);
}

function clearHistory() {
  db.prepare('DELETE FROM history').run();
}

// ---- Schedules ----
function getSchedules() {
  const raw = getConfig('schedules', '[]');
  try { return JSON.parse(raw); } catch { return []; }
}

function setSchedules(times) {
  setConfig('schedules', JSON.stringify(times));
}

module.exports = { getConfig, setConfig, getStocks, findStockName, upsertStockRef, addStock, removeStock, getTypes, setTypeEnabled, isNotified, addHistory, getHistory, clearHistory, getSchedules, setSchedules };
