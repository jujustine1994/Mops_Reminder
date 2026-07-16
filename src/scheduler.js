// 排程模組：管理定時掃描 cron jobs，並執行完整的公告掃描流程
const cron = require('node-cron');
const { getStocks, getTypes, getConfig, isNotified, addHistory, getSchedules } = require('./db');
const { fetchAnnouncements } = require('./crawler');
const { sendNotification } = require('./mailer');
const { writeLog, writeLogHeader, maskEmail } = require('./logger');

let isRunning = false;   // 防止同時多個掃描重疊執行
let activeTasks = [];    // 目前存活的 cron job 清單，用於重設排程時先清除舊的

/** 把起始時間格式化成「N分N秒」，供任務結果行記錄耗時 */
function fmtElapsed(startTime) {
  const s = Math.round((Date.now() - startTime.getTime()) / 1000);
  return `${Math.floor(s / 60)}分${s % 60}秒`;
}

/**
 * 執行一次完整公告掃描：
 * 1. 從 DB 取得監控股票、啟用類型、Email 設定
 * 2. 對每支股票呼叫爬蟲，抓取指定日期範圍的公告
 * 3. 過濾已通知過的公告（防重複），符合類型才加入待發清單
 * 4. 有新公告時寄 Email，並寫入歷史記錄；無論寄信成否，記錄都會保留
 */
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
    const enabledTypes = getTypes().filter(t => t.enabled).map(t => t.id);
    const toEmail = getConfig('email');
    const checkDays = parseInt(getConfig('checkDays', '1'));

    // ---- 三段式第一段：任務起始行（唯一有完整日期的行，關鍵設定塞同一行）----
    // 收件者 Email 遮蔽後才落檔，不寫全文（個資）
    writeLogHeader(`檢查公告 | ${stocks.length}檔追蹤 | ${checkDays}天內 | 收件:${toEmail ? maskEmail(toEmail) : '未設定'}`);

    if (stocks.length === 0) {
      console.log('[scheduler] 沒有監控的股票');
      writeLog(`完成，無追蹤股票，耗時 ${fmtElapsed(startTime)}`, 'OK');
      return { checked: 0, newAnnouncements: 0 };
    }

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
          // ann.type 是 array（如 ['financial','meeting']），需用 some() 比對，不能用 includes()
        const typeMatched = ann.type.some(t => enabledTypes.includes(t));
        if (enabledTypes.length === 0 || typeMatched) {
            ann.stockName = stock.name || stock.code;
            newAnnouncements.push(ann);
            addHistory({ ...ann, stockName: ann.stockName });
          }
        }
      }

      // 避免對 MOPS 太頻繁請求
      await new Promise(r => setTimeout(r, 500));
    }

    let mailed = false;
    let mailFailed = false;
    if (newAnnouncements.length > 0) {
      if (toEmail) {
        try {
          await sendNotification(toEmail, newAnnouncements);
          mailed = true;
          console.log(`[scheduler] Email 已寄送至 ${toEmail}`);
        } catch (mailErr) {
          mailFailed = true;
          // 錯誤行：type + 訊息，Email 遮蔽，不記 object 全文
          writeLog(`寄信失敗 ${maskEmail(toEmail)} -> ${mailErr.constructor.name}: ${mailErr.message}`, 'ERROR');
          console.error(`[scheduler] 郵件寄送失敗，但公告已記錄: ${mailErr.message}`);
        }
      } else {
        console.log(`[scheduler] 發現 ${newAnnouncements.length} 筆新公告 (未設定 Email，僅記錄)`);
      }
    }

    // ---- 三段式第三段：任務結果行（找到 N 筆 + 寄信結果 + 耗時）----
    let resultMsg = `完成，找到 ${newAnnouncements.length} 筆新公告`;
    if (newAnnouncements.length > 0) {
      resultMsg += mailed ? '，寄信成功' : (mailFailed ? '，寄信失敗' : '，未寄信');
    }
    resultMsg += `，耗時 ${fmtElapsed(startTime)}`;
    writeLog(resultMsg, 'OK');

    return { checked: stocks.length, newAnnouncements: newAnnouncements.length };
  } catch (err) {
    // ---- 三段式：錯誤行 + 失敗結果行（type + 訊息，不記 object 全文）----
    writeLog(`檢查失敗 -> ${err.constructor.name}: ${err.message}`, 'ERROR');
    writeLog(`失敗，耗時 ${fmtElapsed(startTime)}`, 'FAIL');
    console.error('[scheduler] 檢查失敗:', err.message);
    throw err;
  } finally {
    isRunning = false;
  }
}

/**
 * 依傳入的時間陣列（如 ["09:00","13:30"]）重設所有 cron jobs
 * 每次儲存設定時呼叫，立即生效，不需重啟 server
 */
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

// server 啟動時呼叫，從 DB 讀取排程設定並啟動 cron jobs
function startScheduler() {
  const times = getSchedules();
  applySchedules(times);
}

module.exports = { startScheduler, runCheck, applySchedules };
