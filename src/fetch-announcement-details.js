// 獨立擷取並保存公告詳情的指令；不載入 scheduler 或 mailer，不會寄信。
const path = require('path');
const { listAnnouncements, fetchAnnouncementDetail } = require('./mops-details');
const { openDetailsDb, sourceId, DEFAULT_DB_PATH } = require('./announcement-details-db');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 暫時性網路錯誤最多重試三次；每次等待時間遞增。 */
async function withRetry(work, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await work(); } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

/**
 * 擷取指定股票與日期範圍內的公告，逐筆寫入獨立資料表。
 * 單筆詳情失敗會記錄後繼續；列表失敗則拋出錯誤，避免誤認為「沒有公告」。
 */
async function captureDetails({ stockCode, from, to, dbPath = DEFAULT_DB_PATH, delayMs = 300 }) {
  const announcements = await withRetry(() => listAnnouncements(stockCode, from, to));
  const store = openDetailsDb(dbPath);
  const result = { listed: announcements.length, saved: 0, failures: [] };
  try {
    for (const announcement of announcements) {
      try {
        const detail = await withRetry(() => fetchAnnouncementDetail(announcement));
        store.save(detail);
        result.saved++;
      } catch (error) {
        result.failures.push({ sourceId: sourceId(announcement), message: error.message });
      }
      if (delayMs > 0) await sleep(delayMs);
    }
    return result;
  } finally {
    store.close();
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--stock', '--from', '--to', '--db'].includes(key) || !argv[i + 1]) {
      throw new Error('用法：node src/fetch-announcement-details.js --stock 2330 --from 2026-09-01 --to 2026-09-02 [--db 測試資料庫路徑]');
    }
    options[key.slice(2)] = argv[i + 1];
  }
  if (!options.stock || !options.from || !options.to) {
    throw new Error('必須指定 --stock、--from、--to');
  }
  return {
    stockCode: options.stock,
    from: options.from,
    to: options.to,
    dbPath: options.db ? path.resolve(options.db) : DEFAULT_DB_PATH,
  };
}

if (require.main === module) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (options) {
    captureDetails(options).then(result => {
      console.log(`列表 ${result.listed} 筆；詳情已保存 ${result.saved} 筆；失敗 ${result.failures.length} 筆`);
      result.failures.forEach(item => console.error(`${item.sourceId}: ${item.message}`));
      if (result.failures.length) process.exitCode = 1;
    }).catch(error => {
      console.error(`擷取失敗：${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { captureDetails, parseArgs };
