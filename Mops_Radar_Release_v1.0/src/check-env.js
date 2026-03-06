const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 正在檢查開發環境...');

let hasError = false;

// 1. 檢查 .env
if (!fs.existsSync('.env')) {
  console.log('❌ 找不到 .env 檔案。請參考 .env.example 建立。');
  hasError = true;
} else {
  console.log('✅ .env 檔案存在');
  
  // 檢查 API Key
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.startsWith('re_你的')) {
    console.log('❌ RESEND_API_KEY 未設定或仍為預設值。');
    hasError = true;
  } else {
    console.log('✅ RESEND_API_KEY 已設定');
  }
}

// 2. 檢查 Chrome (調用 crawler 裡的邏輯)
const { fetchAnnouncements } = require('./crawler'); // 雖然這會報錯，我們直接模擬偵測
function findChromePath() {
  const paths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium-browser']
  };
  const platformPaths = paths[process.platform] || [];
  for (const p of platformPaths) { if (fs.existsSync(p)) return p; }
  return process.env.CHROME_PATH || null;
}

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
  console.log('🚀 環境檢查成功！您可以執行 npm start 開始工作。');
  process.exit(0);
}
