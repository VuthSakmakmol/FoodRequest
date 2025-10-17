// backend/services/transport.telegram.service.js
const axios = require('axios')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const GROUP_ID  = process.env.TELEGRAM_GROUP_ID_TRANSPORT || ''
const SILENT_DM = String(process.env.TELEGRAM_SILENT_DM || 'false').toLowerCase() === 'true'

if (!BOT_TOKEN) console.warn('[Transport TG] TELEGRAM_BOT_TOKEN missing – notifications disabled.')
if (!GROUP_ID)  console.warn('[Transport TG] TELEGRAM_GROUP_ID_TRANSPORT missing – group messages disabled.')

const BASE_URL = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : ''

async function sendToTransportGroup(text, opts = {}) {
  if (!BOT_TOKEN || !GROUP_ID || !text) return
  const payload = {
    chat_id: GROUP_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(opts || {}),
  }
  try { await axios.post(`${BASE_URL}/sendMessage`, payload) }
  catch (e) { console.error('[Transport TG] group send failed:', e?.response?.data || e.message) }
}

async function sendDM(chatId, text, opts = {}) {
  if (!BOT_TOKEN || !chatId || !text) return
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: SILENT_DM,
    ...(opts || {}),
  }
  try { await axios.post(`${BASE_URL}/sendMessage`, payload) }
  catch (e) { console.error('[Transport TG] DM send failed:', e?.response?.data || e.message) }
}

module.exports = { sendToTransportGroup, sendDM }
