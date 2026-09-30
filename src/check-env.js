// 檢查寄信設定、Chrome 與資料夾是否可供現有排程流程使用。
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 正在檢查開發環境...');

let hasError = false;

// 1. 檢查 .env；只看本機公告時寄信設定可留空。
if (!fs.existsSync('.env')) {
  console.log('ℹ️ 找不到 .env；本機查看可用，若要寄信請參考 .env.example 建立。');
} else {
  console.log('✅ .env 檔案存在');
}

const { hasResendKey } = require('./mailer');
if (!hasResendKey()) {
  console.log('ℹ️ RESEND_API_KEY 未設定；本機查看可用，寄信功能暫不可用。');
} else {
  console.log('✅ RESEND_API_KEY 已設定');
}

// 2. 檢查 Chrome；沿用爬蟲的同一套偵測規則，避免兩邊結果不一致。
const { findChromePath } = require('./crawler');
const chromePath = findChromePath();
if (!chromePath || !fs.existsSync(chromePath)) {
  console.log('❌ 找不到 Chrome 瀏覽器。請確保已安裝 Chrome 或設定 CHROME_PATH。');
  hasError = true;
} else {
  console.log('✅ 找到 Chrome:', chromePath);
}

// 3. 檢查 data 資料夾
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  console.log('ℹ️ data/ 資料夾不存在，啟動後將自動建立。');
} else {
  console.log('✅ data/ 資料夾已就緒');
}

console.log('\n---------------------------');
if (hasError) {
  console.log('❌ 環境檢查失敗，請修正以上問題。');
  process.exit(1);
} else {
  console.log('🚀 環境檢查成功！您可以執行 pnpm start 啟動。');
  process.exit(0);
}
