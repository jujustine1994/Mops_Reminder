const cron = require('node-cron');
const { getStocks, getTypes, getConfig, isNotified, addHistory, getSchedules } = require('./db');
const { fetchAnnouncements } = require('./crawler');
const { sendNotification } = require('./mailer');

let isRunning = false;
let activeTasks = [];

async function runCheck() {
  if (isRunning) {
    console.log('[scheduler] 上次檢查尚未完成，跳過本次');
    return { skipped: true };
  }

  isRunning = true;
  const startTime = new Date();
  console.log(`[scheduler] 開始檢查 ${startTime.toLocaleString('zh-TW')}`);

  try {
    const stocks = getStocks();
    if (stocks.length === 0) {
      console.log('[scheduler] 沒有監控的股票');
      return { checked: 0, newAnnouncements: 0 };
    }

    const enabledTypes = getTypes().filter(t => t.enabled).map(t => t.id);
    const toEmail = getConfig('email');
    const checkDays = parseInt(getConfig('checkDays', '1'));

    if (!toEmail) {
      console.log('[scheduler] 尚未設定 Email，跳過通知');
    }

    // 查詢範圍：根據設定的天數
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - checkDays * 24 * 60 * 60 * 1000);
    console.log(`[scheduler] 檢查範圍：從 ${fromDate.toLocaleDateString('zh-TW')} 到 ${toDate.toLocaleDateString('zh-TW')} (${checkDays} 天內)`);

    const newAnnouncements = [];

    for (const stock of stocks) {
      const announcements = await fetchAnnouncements(stock.code, fromDate, toDate);

      for (const ann of announcements) {
        if (!isNotified(ann.stockCode, ann.title, ann.annDate)) {
          if (enabledTypes.length === 0 || enabledTypes.includes(ann.type) || enabledTypes.includes('major')) {
            ann.stockName = stock.name || stock.code;
            newAnnouncements.push(ann);
            addHistory({ ...ann, stockName: ann.stockName });
          }
        }
      }

      // 避免對 MOPS 太頻繁請求
      await new Promise(r => setTimeout(r, 500));
    }

    if (newAnnouncements.length > 0) {
      if (toEmail) {
        try {
          await sendNotification(toEmail, newAnnouncements);
          console.log(`[scheduler] Email 已寄送至 ${toEmail}`);
        } catch (mailErr) {
          console.error(`[scheduler] 郵件寄送失敗，但公告已記錄: ${mailErr.message}`);
        }
      } else {
        console.log(`[scheduler] 發現 ${newAnnouncements.length} 筆新公告 (未設定 Email，僅記錄)`);
      }
    }

    return { checked: stocks.length, newAnnouncements: newAnnouncements.length };
  } catch (err) {
    console.error('[scheduler] 檢查失敗:', err.message);
    throw err;
  } finally {
    isRunning = false;
  }
}

function applySchedules(times) {
  // 清除舊的 cron jobs
  activeTasks.forEach(t => t.stop());
  activeTasks = [];

  if (!times || !times.length) {
    return;
  }

  times.forEach(time => {
    const [h, m] = time.split(':');
    if (h === undefined || m === undefined) return;
    const pattern = `${parseInt(m)} ${parseInt(h)} * * *`;
    const task = cron.schedule(pattern, async () => {
      try { await runCheck(); } catch (e) { console.error('[scheduler] cron error:', e.message); }
    }, { timezone: 'Asia/Taipei' });
    activeTasks.push(task);
  });

  console.log(`[scheduler] 排程已套用：${times.join(', ')}`);
}

function startScheduler() {
  const times = getSchedules();
  applySchedules(times);
}

module.exports = { startScheduler, runCheck, applySchedules };
