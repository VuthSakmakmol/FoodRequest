/* eslint-disable no-console */
// backend/services/telegram/core/telegram.http.js

const axios = require('axios')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const SILENT_DM = String(process.env.TELEGRAM_SILENT_DM || 'false').toLowerCase() === 'true'

function dlog(...args) {
  if (DEBUG) console.log('[TG]', ...args)
}

function base() {
  return `https://api.telegram.org/bot${BOT_TOKEN}`
}

async function sendDM(chatId, text, opts = {}) {
  const cid = String(chatId || '').trim()
  const msg = String(text || '').trim()

  if (!BOT_TOKEN || !cid || !msg) {
    console.warn('[TG] DM skipped', {
      hasToken: !!BOT_TOKEN,
      chatId: cid,
      hasText: !!msg,
    })
    return null
  }

  try {
    const payload = {
      chat_id: cid,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: SILENT_DM,
      ...(opts || {}),
    }

    dlog('DM → sending', { chatId: cid, snippet: msg.slice(0, 80) })
    const { data } = await axios.post(`${base()}/sendMessage`, payload)
    dlog('DM ✓', { ok: data?.ok, message_id: data?.result?.message_id, chatId: cid })
    return data
  } catch (e) {
    console.error('[TG DM ✗]', e?.response?.data || e.message)
    throw e
  }
}

module.exports = { sendDM }