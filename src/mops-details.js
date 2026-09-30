// 從新版 MOPS 歷史重大訊息 API 擷取列表與單筆詳細內容。
const axios = require('axios');

const MOPS_API = 'https://mops.twse.com.tw/mops/api/';
const client = axios.create({
  baseURL: MOPS_API,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; MopsReminder/1.0)',
  },
});

// ---- 日期與回應檢查 ----
function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('日期必須使用 YYYY-MM-DD 格式');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`無效日期：${value}`);
  }
  return date;
}

function toRocCompact(dateText) {
  const date = parseIsoDate(dateText);
  return `${date.getUTCFullYear() - 1911}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function monthPairs(fromText, toText) {
  const from = parseIsoDate(fromText);
  const to = parseIsoDate(toText);
  if (from > to) throw new Error('起始日期不能晚於結束日期');
  const pairs = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  while (y < to.getUTCFullYear() || (y === to.getUTCFullYear() && m <= to.getUTCMonth())) {
    pairs.push({ year: String(y - 1911), month: String(m + 1) });
    m++;
    if (m > 11) { y++; m = 0; }
  }
  return pairs;
}

function assertSuccess(payload, label) {
  if (!payload || payload.code !== 200 || !payload.result) {
    throw new Error(`${label}失敗：${payload?.message || '回應格式不符'}`);
  }
  return payload.result;
}

async function postMops(endpoint, parameters, { allowEmpty = false } = {}) {
  const response = await client.post(endpoint, parameters);
  if (allowEmpty && response.data?.code === 406 && response.data.message === '查無相符資料') {
    return { data: [] };
  }
  return assertSuccess(response.data, endpoint);
}

// ---- 列表與詳情 ----
/**
 * 查詢指定日期範圍的歷史公告。詳情識別參數完全來自 MOPS 列表，不自行猜序號或市場別。
 */
async function listAnnouncements(stockCode, fromText, toText) {
  if (!/^[A-Za-z0-9]{4,8}$/.test(stockCode)) throw new Error(`股票代號格式不符：${stockCode}`);
  const fromRoc = toRocCompact(fromText);
  const toRoc = toRocCompact(toText);
  const announcements = [];

  for (const { year, month } of monthPairs(fromText, toText)) {
    const result = await postMops('t05st01', {
      companyId: stockCode,
      year,
      month,
      firstDay: '',
      lastDay: '',
    }, { allowEmpty: true });
    if (!Array.isArray(result.data)) throw new Error('歷史公告列表格式不符');

    for (const row of result.data) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const descriptor = row[5];
      if (descriptor?.apiName !== 't05st01_detail' || !descriptor.parameters) continue;
      const params = descriptor.parameters;
      const rocDate = String(params.enterDate || '');
      if (rocDate < fromRoc || rocDate > toRoc) continue;
      announcements.push({
        stockCode: String(stockCode),
        companyName: String(row[1] || '').trim(),
        annDate: String(row[2] || '').trim(),
        annTime: String(row[3] || '').trim(),
        title: String(row[4] || '').trim(),
        apiName: descriptor.apiName,
        parameters: { ...params },
      });
    }
  }
  return announcements;
}

/** 讀取單筆詳細資料，保留官方欄位與「說明」原有換行。 */
async function fetchAnnouncementDetail(announcement) {
  if (announcement.apiName !== 't05st01_detail') throw new Error('不支援的公告詳情 API');
  const p = announcement.parameters;
  if (!p || !/^\d{7}$/.test(String(p.enterDate || '')) ||
      !/^[A-Za-z0-9]+$/.test(String(p.companyId || '')) ||
      !/^[A-Za-z0-9]+$/.test(String(p.marketKind || '')) ||
      !/^\d+$/.test(String(p.serialNumber ?? ''))) {
    throw new Error('公告詳情識別參數不完整');
  }

  const result = await postMops('t05st01_detail', p);
  if (!Array.isArray(result.titles) || !Array.isArray(result.data) ||
      result.data.length === 0 || !result.data.every(Array.isArray)) {
    throw new Error('公告詳細內容格式不符');
  }
  const sections = result.data.map(row => {
    const fields = {};
    result.titles.forEach((column, index) => {
      if (column?.main) fields[column.main] = String(row[index] ?? '').trim();
    });
    return fields;
  });
  const detailText = sections.map(fields => fields['說明']).filter(Boolean).join('\n\n');
  if (!detailText) throw new Error('公告詳細內容缺少「說明」');
  return { ...announcement, fields: sections[0], detailText, detailPayload: result };
}

module.exports = { listAnnouncements, fetchAnnouncementDetail, parseIsoDate, monthPairs };
