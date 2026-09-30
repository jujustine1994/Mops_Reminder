// 將既有通知紀錄對應到 MOPS 詳情；先讀本機快取，找不到才向 MOPS 查詢。
const { listAnnouncements, fetchAnnouncementDetail, parseIsoDate } = require('./mops-details');
const { openDetailsDb, sourceId } = require('./announcement-details-db');

const normalizeTitle = value => String(value || '').replace(/\s+/g, '').trim();
function timesMatch(historyTime, candidateTime) {
  const left = String(historyTime || '');
  const right = String(candidateTime || '');
  return left.length >= 8 && right.length >= 8 ? left.slice(0, 8) === right.slice(0, 8) : left.slice(0, 5) === right.slice(0, 5);
}

function historyDateToIso(annDate) {
  const match = String(annDate || '').match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) throw new Error('既有通知紀錄的公告日期格式不符');
  const iso = `${Number(match[1]) + 1911}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  parseIsoDate(iso);
  return iso;
}

/** 同日同公司可能有多筆公告；若標題與時間仍無法唯一對應，就拒絕顯示以免看錯內容。 */
function matchHistory(history, candidates) {
  const sameTitle = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(history.title));
  const matches = history.ann_time
    ? sameTitle.filter(item => timesMatch(history.ann_time, item.annTime || item.ann_time))
    : sameTitle;
  if (matches.length === 1) return matches[0];
  const error = new Error(matches.length ? '找到多筆相似公告，無法確認正確內容' : 'MOPS 查無這筆公告的詳細內容');
  error.status = matches.length ? 409 : 404;
  throw error;
}

/** 開啟通知詳情；成功查到的舊紀錄會存入本機，下一次直接讀取。 */
async function getHistoryDetail(history, dbPath) {
  const store = openDetailsDb(dbPath);
  try {
    const cached = store.findByStockDate(history.stock_code, history.ann_date);
    let row;
    try { row = matchHistory(history, cached); } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (!row) {
      const isoDate = historyDateToIso(history.ann_date);
      const candidates = await listAnnouncements(history.stock_code, isoDate, isoDate);
      const announcement = matchHistory(history, candidates);
      const detail = await fetchAnnouncementDetail(announcement);
      store.save(detail);
      row = store.get(sourceId(detail));
    }
    return {
      sourceId: row.source_id,
      stockCode: row.stock_code,
      companyName: row.company_name,
      annDate: row.ann_date,
      annTime: row.ann_time,
      title: row.title,
      fields: JSON.parse(row.fields_json),
      detailText: row.detail_text,
    };
  } finally {
    store.close();
  }
}

module.exports = { getHistoryDetail, matchHistory, historyDateToIso };
