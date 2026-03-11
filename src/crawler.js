const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

// 自動偵測 Chrome 路徑
function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const paths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
    ]
  };

  const platformPaths = paths[process.platform] || [];
  for (const p of platformPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CHROME_PATH = findChromePath();
const MOPS_HISTORY_URL = 'https://mopsov.twse.com.tw/mops/web/t05st01';

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  
  if (!CHROME_PATH) {
    throw new Error('找不到 Chrome 瀏覽器。請確保已安裝 Chrome，或在 .env 中設定 CHROME_PATH 為正確的執行檔路徑。');
  }

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  console.log('[crawler] Chrome 已啟動:', CHROME_PATH);
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

function toRocDate(date) {
  const y = date.getFullYear() - 1911;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║              公告分類規則 — 唯一維護點                          ║
// ║  classifyType()、前端類型清單、Email 標籤，全部從這裡讀取       ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// ── 結構說明 ──────────────────────────────────────────────────────
//   id              : 分類的英文 key，與 DB config 的 enabledTypes 對應
//                     ★ 改了 id 必須同步更新 DB，否則使用者設定會失效
//   label           : 顯示在前端與 Email 的中文名稱，改了立即生效
//   keywords        : 公告標題「包含其中任一關鍵字」就歸入此類
//                     ★ 比對方式：title.includes(keyword)，大小寫視為不同
//   excludeKeywords : 標題「包含其中任一排除詞」就不歸入此類（可選欄位）
//                     用途：避免「財務報告含合併字眼」被誤判為合併/收購
//   note            : 給人看的備註，不影響邏輯（可選欄位）
//
// ── 如何新增一個分類 ──────────────────────────────────────────────
//   1. 在 CATEGORY_RULES 陣列中，於 major（最後一行）前插入新物件
//   2. id 用英文小寫加底線，例如 'litigation'
//   3. label 寫中文，例如 '訴訟/仲裁'
//   4. keywords 填入公告標題常見關鍵字
//   5. 若有誤判風險，加上 excludeKeywords
//   ★ 不需改其他檔案，前端類型清單由 GET /api/config 自動讀這裡
//
// ── 如何修改現有分類的關鍵字 ─────────────────────────────────────
//   直接在對應的 keywords 陣列加/刪字串即可，存檔後重啟 server 生效
//   例：'dividend' 要多抓「息票」→ 在 dividend.keywords 加 '息票'
//
// ── major 的特殊行為 ──────────────────────────────────────────────
//   major 的 keywords 必須保持空陣列 []
//   它是保底分類：當所有其他分類都不符合時，自動歸入 major
//   若刪除 major 這行，沒被歸類的公告將直接被過濾掉（不發通知）
//
// ── 分類優先順序 ──────────────────────────────────────────────────
//   一則公告可同時屬於多個分類（多標籤）
//   陣列順序決定 Email 標籤的排列順序，建議重要類型放前面
//
const CATEGORY_RULES = [
  { id: 'financial',      label: '財務報告',    keywords: ['財務報告','季報','年報','半年報','財報','損益','獲利','盈餘','自結','營收','營運成績','營運結果','營運績效'] },
  { id: 'meeting',        label: '重要會議',    keywords: ['股東會','董事會','股東常會','股東臨時會','召開','決議','議案'] },
  { id: 'earnings',       label: '法說會',      keywords: ['法說會','法人說明會','業績說明會','說明會','投資人會議'] },
  { id: 'dividend',       label: '股利公告',    keywords: ['股利','除權','除息','盈餘分配','盈餘分派','現金','股票','配息','配股','配發'] },
  { id: 'merger',         label: '合併/收購',   keywords: ['合併','收購','分割','購併','併購'], excludeKeywords: ['財務報告','營收'], note: '排除財務報告/營收誤判' },
  { id: 'board',          label: '董監事異動',  keywords: ['辭職','卸任','新任','改派','改選','補選','解任','辭任','任期屆滿','委任','指派'] },
  { id: 'capital_change', label: '股本變動',    keywords: ['可轉債','增資','私募','認股','股權','可轉換公司債','庫藏股','買回股份','減資','發行新股','公司債','CB','現增','註銷','轉換'] },
  { id: 'asset_disposal', label: '處分資產',    keywords: ['處分','取得','資產','不動產','機器','設備','廠房','工程','土地'] },
  { id: 'clarify',        label: '報導相關',    keywords: ['澄清','媒體','報導','報載','雜誌','內容','新聞'] },
  { id: 'major',          label: '其他重大訊息', keywords: [], note: '以上皆不符合時的保底分類，keywords 必須維持空陣列' },
];

function classifyType(title) {
  const tags = [];

  for (const rule of CATEGORY_RULES) {
    if (rule.id === 'major') continue;
    if (!rule.keywords.some(k => title.includes(k))) continue;
    if (rule.excludeKeywords && rule.excludeKeywords.some(k => title.includes(k))) continue;
    tags.push(rule.id);
  }

  if (tags.length === 0) tags.push('major');
  return [...new Set(tags)];
}

function matchesEnabledTypes(title, enabledTypeIds) {
  const matched = classifyType(title);
  // 只要其中一個匹配到的類型是被啟用的，就回傳 true
  return matched.some(t => enabledTypeIds.includes(t));
}

async function fetchAnnouncements(stockCode, fromDate, toDate) {
  const MAX_RETRIES = 3;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      return await _fetchAnnouncementsInternal(stockCode, fromDate, toDate);
    } catch (err) {
      retryCount++;
      console.error(`[crawler] 爬取 ${stockCode} 失敗 (第 ${retryCount} 次重試):`, err.message);
      if (retryCount >= MAX_RETRIES) return [];
      await new Promise(r => setTimeout(r, 2000 * retryCount)); // 指數退避
    }
  }
}

async function _fetchAnnouncementsInternal(stockCode, fromDate, toDate) {
  const filterFromRoc = toRocDate(fromDate);
  const filterToRoc = toRocDate(toDate);
  
  // 建立 (rocYear, month) pair 集合，支援跨年查詢
  const pairsToQuery = new Map();
  const addPair = (date) => {
    const rocYear = date.getFullYear() - 1911;
    const month = date.getMonth() + 1;
    const key = `${rocYear}/${month}`;
    if (!pairsToQuery.has(key)) pairsToQuery.set(key, { rocYear, month });
  };
  addPair(fromDate);
  addPair(toDate);

  const allResults = [];
  let page = null;

  try {
    const br = await getBrowser();
    page = await br.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    for (const { rocYear, month } of pairsToQuery.values()) {
      console.log(`[crawler] 正在查詢 ${stockCode} 民國 ${rocYear} 年第 ${month} 月份公告...`);
      await page.goto(MOPS_HISTORY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      await page.waitForSelector('#co_id');
      await page.type('#co_id', stockCode);

      await page.click('#year', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#year', String(rocYear));

      await page.select('#month', String(month));

      const searchBtn = await page.waitForSelector('input[type="button"][value="查詢"], input[type="button"][value=" 查詢 "]');
      await searchBtn.click();

      try {
        await page.waitForFunction(() => {
          const tables = document.querySelectorAll('table');
          return Array.from(tables).some(t => t.innerText.includes('發言日期') && t.querySelectorAll('tr').length > 1);
        }, { timeout: 10000 });
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.log(`[crawler] ${stockCode} 第 ${month} 月份未偵測到結果表格`);
        continue;
      }

      const html = await page.content();
      const $ = cheerio.load(html);

      $('tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length < 5) return;

        const codeFound = $(cells[0]).text().trim();
        const annDate   = $(cells[2]).text().trim();
        const annTime   = $(cells[3]).text().trim();
        const title     = $(cells[4]).text().trim();
        // 驗證是否為目標股票與日期
        if (codeFound === stockCode && annDate.includes('/')) {
          const dParts = annDate.split('/');
          if (dParts.length >= 3) {
            const y = dParts[0].padStart(3, '0');
            const m = dParts[1].padStart(2, '0');
            const d = dParts[2].substring(0, 2).padStart(2, '0');
            const cleanDate = `${y}${m}${d}`;

            if (cleanDate >= filterFromRoc && cleanDate <= filterToRoc) {
              // 核心修復：抓取直接連結
              // mopsov 的 onclick 通常長這樣: viewMainBoard('3017','1150306','1','t05st01',...)
              const onclick = $(cells[4]).find('input[type="button"]').attr('onclick') || '';
              const p = onclick.match(/'(.*?)'/g)?.map(s => s.replace(/'/g, '')) || [];

              let directLink = 'https://mops.twse.com.tw/mops/web/t05sr01';
              if (p.length >= 3) {
                // 拼接直接讀取公告內容的 URL
                directLink = `https://mops.twse.com.tw/mops/web/ajax_t05sr01?step=1&TYPEK=all&co_id=${p[0]}&year=${p[1].substring(0,3)}&month=${p[1].substring(3,5)}&day=${p[1].substring(5,7)}&seq_no=${p[2]}`;
              }

              allResults.push({
                stockCode,
                annDate,
                annTime,
                title,
                link: directLink,
                type: classifyType(title)
              });
            }
          }
        }
      });
    }

    const uniqueResults = [];
    const seen = new Set();
    allResults.forEach(r => {
      const key = `${r.annDate}-${r.annTime}-${r.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(r);
      }
    });

    console.log(`[crawler] ${stockCode} 查詢完成，符合範圍內共找到 ${uniqueResults.length} 筆資料`);
    return uniqueResults;

  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
}

async function fetchStockName(stockCode) {
  const MAX_RETRIES = 2;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      return await _fetchStockNameInternal(stockCode);
    } catch (err) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) return stockCode;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function _fetchStockNameInternal(stockCode) {
  let page = null;
  try {
    const br = await getBrowser();
    page = await br.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.goto(MOPS_HISTORY_URL, { waitUntil: 'networkidle2', timeout: 20000 });

    await page.waitForSelector('#co_id');
    await page.type('#co_id', stockCode);
    
    // 隨便輸一個年份來觸發查詢以獲取公司名
    const year = (new Date()).getFullYear() - 1911;
    await page.type('#year', String(year));
    
    await page.click('input[type="button"][value="查詢"], input[type="button"][value=" 查詢 "]');

    // 在 mopsov 頁面中，公司名稱通常會出現在藍色文字或特定標籤裡
    // 我們直接從頁面內容中搜尋關鍵字
    await page.waitForFunction(() => {
      return document.body.innerText.includes('公司提供') || document.body.innerText.includes('公司名稱');
    }, { timeout: 8000 }).catch(() => {});

    const name = await page.evaluate(() => {
      // 邏輯 A: 尋找「本資料由 (上市公司) 3017 奇鋐 公司提供」這段文字
      const bodyText = document.body.innerText;
      const match = bodyText.match(/\d{4}\s+([^\s]+)\s+公司提供/);
      if (match && match[1]) return match[1].trim();

      // 邏輯 B: 傳統標籤
      const el = document.querySelector('.companyName') || document.querySelector('#show_co_name');
      if (el) return el.innerText.replace('公司名稱：', '').trim();
      
      return null;
    });

    return name || stockCode;
  } catch (err) {
    console.error(`[crawler] 取得股名 ${stockCode} 異常:`, err.message);
    return stockCode;
  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
}

module.exports = { fetchAnnouncements, fetchStockName, classifyType, matchesEnabledTypes, closeBrowser, CATEGORY_RULES };
