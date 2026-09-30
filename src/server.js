// 本機 Express 入口：提供設定、通知歷史、公告詳情與手動掃描 API。
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { runCheck, startScheduler, applySchedules } = require('./scheduler');
const { sendTestEmail } = require('./mailer');
const { getHistoryDetail } = require('./history-detail');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Log 攔截器 ----
const systemLogs = [];
const MAX_LOGS = 100;

// systemLogs 只進記憶體、餵網頁 UI，本身不落檔（落檔由 src/logger.js 三段式負責）。
// 但仍不可對 object 無差別 JSON.stringify：err / API response 整包可能挾帶 RESEND_API_KEY
// 或個資，一旦日後有人把這裡接上落檔就會外洩，故在源頭就做安全摘要（導入順序警告）。
function safeArg(arg) {
  if (arg instanceof Error) return arg.message;            // Error 只取 message，不 dump stack / 屬性
  if (arg !== null && typeof arg === 'object') {
    // 不整包 stringify，截斷成短摘要，避免把 response/payload 全文帶進來
    const s = JSON.stringify(arg);
    return s.length > 200 ? s.slice(0, 200) + '…(截斷)' : s;
  }
  return String(arg);
}

function addLog(type, args) {
  const msg = args.map(safeArg).join(' ');
  const timestamp = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  // 用上 type，讓 UI 能區分 INFO / ERROR（原本 type 收了卻沒用）
  systemLogs.push(`[${timestamp}] [${type}] ${msg}`);
  if (systemLogs.length > MAX_LOGS) systemLogs.shift();
}

const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  addLog('INFO', args);
  originalLog.apply(console, args);
};

console.error = (...args) => {
  addLog('ERROR', args);
  originalError.apply(console, args);
};

app.get('/api/logs', (req, res) => {
  res.json(systemLogs);
});

// ---- 設定 ----
app.get('/api/config', (req, res) => {
  res.json({
    email: db.getConfig('email', ''),
    checkDays: parseInt(db.getConfig('checkDays', '1')),
    stocks: db.getStocks(),
    types: db.getTypes(),
    schedules: db.getSchedules(),
  });
});

app.post('/api/config', (req, res) => {
  const { email, checkDays, stocks, types, schedules } = req.body;

  if (email !== undefined) db.setConfig('email', email);
  if (checkDays !== undefined) db.setConfig('checkDays', String(checkDays));

  if (Array.isArray(stocks)) {
    const current = db.getStocks().map(s => s.code);
    const incoming = stocks.map(s => s.code || s);
    
    // 刪除不再清單中的
    current.filter(c => !incoming.includes(c)).forEach(c => db.removeStock(c));
    
    // 新增或更新
    stocks.forEach(s => {
      const code = s.code || s;
      // 如果前端沒傳名字，或是名字是「搜尋中...」，我們去資料庫抓最新的
      let name = s.name || '';
      if (!name || name === '搜尋中...') {
        name = db.findStockName(code) || '';
      }
      db.addStock(code, name);
    });
  }

  if (Array.isArray(types)) {
    types.forEach(t => db.setTypeEnabled(t.id, t.enabled));
  }

  if (Array.isArray(schedules)) {
    db.setSchedules(schedules);
    applySchedules(schedules);
  }

  res.json({ ok: true });
});

// ---- 股票 ----
const { fetchStockName } = require('./crawler');

app.get('/api/stock-name/:code', async (req, res) => {
  const code = req.params.code;
  try {
    // 1. 先從資料庫找 (秒出)
    const existingName = db.findStockName(code);
    if (existingName) {
      console.log(`[server] 從資料庫找到股名: ${code} ${existingName}`);
      return res.json({ name: existingName });
    }

    // 2. 找不到才爬蟲 (需等待幾秒)
    console.log(`[server] 資料庫查無 ${code}，啟動爬蟲抓取名稱...`);
    const name = await fetchStockName(code);
    
    // 3. 只要抓到正確的名字 (不是回傳代號本身)，就存入對照表「自動學習」
    if (name && name !== code) {
      console.log(`[server] 成功抓取新股票名稱，已同步存入對照表: ${code} ${name}`);
      db.upsertStockRef([{ code, name }]);
    }
    
    res.json({ name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stocks', (req, res) => {
  const { code, name } = req.body;
  if (!code) return res.status(400).json({ error: '需要股票代碼' });
  db.addStock(code, name || '');
  res.json({ ok: true, stocks: db.getStocks() });
});

app.delete('/api/stocks/:code', (req, res) => {
  db.removeStock(req.params.code);
  res.json({ ok: true, stocks: db.getStocks() });
});

// ---- 公告類型 ----
app.patch('/api/types/:id', (req, res) => {
  db.setTypeEnabled(req.params.id, req.body.enabled);
  res.json({ ok: true });
});

// ---- 分類規則（單一來源，供前端說明彈窗使用）----
const { CATEGORY_RULES } = require('./crawler');
app.get('/api/categories', (req, res) => {
  res.json(CATEGORY_RULES);
});

// ---- 歷史記錄 ----
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  res.json(db.getHistory(limit));
});

app.get('/api/history/:id/detail', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: '無效的公告編號' });
  const history = db.getHistoryById(id);
  if (!history) return res.status(404).json({ error: '找不到這筆通知紀錄' });
  try {
    res.json(await getHistoryDetail(history));
  } catch (error) {
    console.error(`[server] 讀取公告詳情失敗 #${id}: ${error.message}`);
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.delete('/api/history', (req, res) => {
  try {
    if (req.query.preserveDetails === '1') db.clearHistory();
    else db.clearHistoryAndDetails();
    res.json({ ok: true });
  } catch (error) {
    console.error(`[server] 清除通知紀錄失敗: ${error.message}`);
    res.status(500).json({ error: '清除通知紀錄失敗' });
  }
});

// ---- 手動觸發 ----
app.post('/api/run-now', async (req, res) => {
  try {
    const result = await runCheck();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- 測試信件 ----
app.post('/api/test-email', async (req, res) => {
  const email = req.body.email || db.getConfig('email');
  if (!email) return res.status(400).json({ error: '未設定 Email' });
  try {
    await sendTestEmail(email);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const { closeBrowser } = require('./crawler');

function showCTHBanner() {
    const b = '\x1b[90m';   // 邊框：深灰
    const c = '\x1b[96m';   // CTH 字母：亮青
    const y = '\x1b[93m';   // 署名：金黃
    const r = '\x1b[0m';    // reset

    console.log(
        `${b}/*  ================================  *\\${r}\n` +
        `${b} *                                    *${r}\n` +
        `${b} *    ${c}██████╗████████╗██╗  ██╗${b}        *${r}\n` +
        `${b} *   ${c}██╔════╝   ██║   ██║  ██║${b}        *${r}\n` +
        `${b} *   ${c}██║        ██║   ███████║${b}        *${r}\n` +
        `${b} *   ${c}██║        ██║   ██╔══██║${b}        *${r}\n` +
        `${b} *   ${c}╚██████╗   ██║   ██║  ██║${b}        *${r}\n` +
        `${b} *    ${c}╚═════╝   ╚═╝   ╚═╝  ╚═╝${b}        *${r}\n` +
        `${b} *                                    *${r}\n` +
        `${b} *          ${y}created by CTH${b}            *${r}\n` +
        `${b}\\*  ================================  */${r}`
    );
}

const PORT = process.env.PORT || 7853;
// 綁 127.0.0.1：不給 host 的話 Express 預設綁 0.0.0.0，同網段任何人都連得到。
// 本服務所有 API 都沒有驗證（POST /api/config 可直接改掉通知信箱），只該讓本機用。
app.listen(PORT, '127.0.0.1', () => {
  showCTHBanner();
  const url = `http://localhost:${PORT}`;
  console.log(`台股公告雷達 啟動於 ${url}`);
  
  // 自動開啟瀏覽器
  const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
  require('child_process').exec(`${start} ${url}`);
  
  startScheduler();
});

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
