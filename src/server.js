require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { runCheck, startScheduler, applySchedules } = require('./scheduler');
const { sendTestEmail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Log 攔截器 ----
const systemLogs = [];
const MAX_LOGS = 100;

function addLog(type, args) {
  const msg = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  const timestamp = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  systemLogs.push(`[${timestamp}] ${msg}`);
  
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

// ---- 歷史記錄 ----
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  res.json(db.getHistory(limit));
});

app.delete('/api/history', (req, res) => {
  db.clearHistory();
  res.json({ ok: true });
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

const PORT = process.env.PORT || 7853;
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`台股公告雷達 啟動於 ${url}`);
  
  // 自動開啟瀏覽器
  const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
  require('child_process').exec(`${start} ${url}`);
  
  startScheduler();
});

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
