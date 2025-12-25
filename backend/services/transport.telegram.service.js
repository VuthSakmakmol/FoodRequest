// backend/services/transport.telegram.service.js
const axios = require('axios')

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN || ''
const DM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN_DM || BOT_TOKEN
const GROUP_ID      = process.env.TELEGRAM_GROUP_ID_TRANSPORT || ''
const DEBUG         = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

const base = (t) => `https://api.telegram.org/bot${t}`

async function sendToTransportGroup(text, opts = {}) {
  if (!BOT_TOKEN || !GROUP_ID || !text) {
    if (DEBUG) console.log('[TG group skip]', { hasToken: !!BOT_TOKEN, hasGroup: !!GROUP_ID, hasText: !!text })
    return
  }
  try {
    if (DEBUG) console.log('[TG group →] sending', { groupId: GROUP_ID, snippet: String(text).slice(0, 60) })
    const { data } = await axios.post(`${base(BOT_TOKEN)}/sendMessage`, {
      chat_id: GROUP_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      // ✅ group should also not be silent (default)
      disable_notification: false,
      ...(opts || {}),
    })
    if (DEBUG) console.log('[TG group ✓]', { ok: data?.ok, message_id: data?.result?.message_id })
  } catch (e) {
    console.error('[TG group ✗]', e?.response?.data || e.message)
  }
}

async function sendDM(chatId, text, opts = {}) {
  if (!DM_BOT_TOKEN || !chatId || !text) {
    if (DEBUG) console.log('[TG DM skip]', { hasToken: !!DM_BOT_TOKEN, chatId, hasText: !!text })
    return
  }
  try {
    if (DEBUG) console.log('[TG DM →] sending', { chatId, snippet: String(text).slice(0, 60) })
    const { data } = await axios.post(`${base(DM_BOT_TOKEN)}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,

      disable_notification: false,

      ...(opts || {}),
    })
    if (DEBUG) console.log('[TG DM ✓]', { ok: data?.ok, message_id: data?.result?.message_id, chatId })
  } catch (e) {
    console.error('[TG DM ✗]', e?.response?.data || e.message)
  }
}

module.exports = { sendToTransportGroup, sendDM }
