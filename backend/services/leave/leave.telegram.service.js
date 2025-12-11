// backend/services/leave/leave.telegram.service.js
/* eslint-disable no-console */
const axios = require('axios')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const SILENT_DM = String(process.env.TELEGRAM_SILENT_DM || 'true').toLowerCase() === 'true'

function dlog(...args) {
  if (DEBUG) console.log('[LeaveTG]', ...args)
}

function base() {
  return `https://api.telegram.org/bot${BOT_TOKEN}`
}

/**
 * Send direct message for LEAVE module
 * @param {string|number} chatId
 * @param {string} text
 * @param {object} opts  extra Telegram options
 */
async function sendLeaveDM(chatId, text, opts = {}) {
  if (!BOT_TOKEN || !chatId || !text) {
    dlog('DM skip', {
      hasToken: !!BOT_TOKEN,
      chatId,
      hasText: !!text,
    })
    return
  }

  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: SILENT_DM,
      ...(opts || {}),
    }

    dlog('DM → sending', {
      chatId,
      snippet: String(text).slice(0, 80),
    })

    const { data } = await axios.post(`${base()}/sendMessage`, payload)

    dlog('DM ✓', {
      ok: data?.ok,
      message_id: data?.result?.message_id,
      chatId,
    })
  } catch (e) {
    console.error('[LeaveTG DM ✗]', e?.response?.data || e.message)
  }
}

module.exports = {
  sendLeaveDM,
}
