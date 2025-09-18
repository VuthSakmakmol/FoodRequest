// Lightweight Telegram sender used by controllers
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_IDS = (process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.warn('[Telegram] TELEGRAM_BOT_TOKEN missing – notifications disabled.');
}
if (CHAT_IDS.length === 0) {
  console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_IDS empty – no recipients configured.');
}

async function sendToAll(text, opts = {}) {
  if (!BOT_TOKEN || CHAT_IDS.length === 0) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payloadBase = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  };

  await Promise.allSettled(
    CHAT_IDS.map(chat_id =>
      axios.post(url, { chat_id, text, ...payloadBase })
    )
  );
}

module.exports = { sendToAll };
