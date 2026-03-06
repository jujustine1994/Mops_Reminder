const { fetchAnnouncements } = require('./src/crawler');

async function test() {
  console.log('--- mopsov 爬蟲最終測試 (3017) ---');
  const today = new Date();
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(today.getDate() - 3);

  const results = await fetchAnnouncements('3017', threeDaysAgo, today);
  
  console.log('--- 測試結果 ---');
  if (results.length > 0) {
    console.log(`成功爬取到 ${results.length} 筆公告:`);
    results.forEach((r, i) => {
      console.log(`[${i+1}] ${r.annDate} ${r.annTime} - ${r.title}`);
    });
  } else {
    console.log('查無公告，請確認 3017 在這 3 天內是否有發布重大訊息');
  }
  process.exit(0);
}

test();
