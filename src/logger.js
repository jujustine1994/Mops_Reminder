// 執行紀錄落檔模組：把「排程檢查」這類任務以三段式寫入 logs/app.log
// 用 fs.appendFileSync（等價開檔→寫→關檔，不持有 handle），與 launcher.ps1 寫同一個檔
// 絕不可用 fs.createWriteStream：它持有 handle，會讓 PS1 側寫不進同一個檔（windows-tool 地雷十）
const fs = require('fs');
const path = require('path');

// logs/ 永遠在專案根目錄（launcher.ps1 旁）。server.js 位於 src/，往上一層即為根
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

/** HH:MM:SS，內文行用（日期只出現在 header 行） */
function timeStr() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

/** yyyy-MM-dd HH:MM:SS，只有 header 行有完整日期 */
function fullStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 寫一行內文（錯誤行 / 結果行）。每次 append 開檔→寫→關檔，不持有 handle（地雷十）。
 * 只接受已組好的字串——呼叫端負責過濾，不可把 err/response 物件整包丟進來（導入順序警告）。
 */
function writeLog(msg, level = 'INFO') {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // \r\n 與 PS1 側 AppendAllText 一致；appendFileSync 預設 utf8 不寫 BOM（地雷十一）
    fs.appendFileSync(LOG_FILE, `[${timeStr()}] [${String(level).padEnd(5)}] ${msg}\r\n`);
  } catch (e) {
    // log 掛掉不能拖垮主程式；也涵蓋兩個實例同時撞在一起的情況（規則 7）
  }
}

/** 任務起始行：唯一有完整日期的行，關鍵設定塞在同一行 */
function writeLogHeader(msg) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `=== ${fullStamp()} ${msg} ===\r\n`);
  } catch (e) {
    // 同上
  }
}

/**
 * Email 個資遮蔽：jujustine1994@gmail.com -> j***@gmail.com
 * 落檔前一律先過這裡，不寫收件者全文
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return email[0] + '***' + email.slice(at);
}

module.exports = { writeLog, writeLogHeader, maskEmail };
