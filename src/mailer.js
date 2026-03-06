const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

/**
 * 寄送新公告通知
 */
async function sendNotification(toEmail, announcements) {
  if (!announcements || announcements.length === 0) return;

  const count = announcements.length;
  const subject = `[台股公告雷達] 發現 ${count} 筆新訊息`;
  
  // 建立 HTML 內容
  let html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
      <h2 style="color: #00d4aa; margin-bottom: 20px;">📡 發現新公告</h2>
      <p style="color: #4a5568;">您的監控清單中有新的重大訊息：</p>
      <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;">
  `;

  announcements.forEach(ann => {
    html += `
      <div style="margin-bottom: 20px; padding: 12px; background: #f7fafc; border-radius: 8px;">
        <div style="font-weight: bold; color: #2d3748; margin-bottom: 4px;">
          <span style="background: #00d4aa; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 8px;">${ann.stockCode}</span>
          ${ann.stockName || ''}
        </div>
        <div style="font-size: 14px; color: #4a5568; margin-bottom: 8px;">${ann.title}</div>
        <div style="font-size: 12px; color: #a0aec0;">
          ${ann.annDate} ${ann.annTime} | 類型: ${ann.type}
        </div>
        <div style="margin-top: 10px;">
          <a href="${ann.link}" target="_blank" style="display: inline-block; padding: 6px 12px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-size: 12px;">查看完整公告</a>
        </div>
      </div>
    `;
  });

  html += `
      <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;">
      <p style="font-size: 12px; color: #a0aec0; text-align: center;">此信件由 台股公告雷達 自動發送</p>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: toEmail,
      subject: subject,
      html: html,
    });

    if (error) {
      throw new Error(error.message);
    }
    return data;
  } catch (err) {
    console.error('[mailer] Resend 寄信失敗:', err.message);
    throw err;
  }
}

/**
 * 寄送測試信件
 */
async function sendTestEmail(toEmail) {
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: toEmail,
      subject: '📡 台股公告雷達 - 測試信件',
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 40px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h1 style="color: #00d4aa;">測試成功！</h1>
          <p>您的 Resend 發信功能已正確連接。</p>
          <p style="color: #718096; font-size: 14px;">收件人: ${toEmail}</p>
        </div>
      `,
    });

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    console.error('[mailer] 測試信寄送失敗:', err.message);
    throw err;
  }
}

module.exports = { sendNotification, sendTestEmail };
