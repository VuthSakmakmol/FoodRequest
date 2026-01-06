// backend/services/telegram.service.js
// Lightweight Telegram sender (NO webhook). Works whether polling is enabled or not.
// Use axios to call Telegram sendMessage API from controllers/services.

const axios = require('axios')

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : ''

const ADMIN_CHAT_IDS = (process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const GROUP_TRANSPORT = String(process.env.TELEGRAM_GROUP_ID_TRANSPORT || '').trim()
const GROUP_FOOD = String(process.env.TELEGRAM_GROUP_ID_FOOD || '').trim()

const ENABLE_EMPLOYEE_DM =
  String(process.env.TELEGRAM_ENABLE_EMPLOYEE_DM || '').trim().toLowerCase() === 'true'

const SILENT_DM_DEFAULT =
  String(process.env.TELEGRAM_SILENT_DM || '').trim().toLowerCase() === 'true'

function tgErr(err) {
  if (!err) return ''
  // axios error payload
  const d = err?.response?.data
  if (d?.description) return d.description
  return err?.message || String(err)
}

function assertReady() {
  if (!BOT_TOKEN || !API_BASE) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN missing – notifications disabled.')
    return false
  }
  return true
}

async function sendMessage(chat_id, text, opts = {}) {
  if (!assertReady()) return { ok: false, skipped: true, reason: 'NO_TOKEN' }
  if (!chat_id) return { ok: false, skipped: true, reason: 'NO_CHAT_ID' }
  if (!text) return { ok: false, skipped: true, reason: 'NO_TEXT' }

  const payload = {
    chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  }

  try {
    const { data } = await axios.post(`${API_BASE}/sendMessage`, payload)
    return { ok: true, data }
  } catch (err) {
    console.error('[Telegram] sendMessage failed:', {
      chat_id,
      err: tgErr(err),
      response: err?.response?.data || null,
    })
    return { ok: false, err: tgErr(err) }
  }
}

async function sendToMany(chatIds, text, opts = {}) {
  if (!assertReady()) return { ok: false, skipped: true, reason: 'NO_TOKEN' }

  const ids = (Array.isArray(chatIds) ? chatIds : [])
    .map(x => String(x).trim())
    .filter(Boolean)

  if (ids.length === 0) return { ok: false, skipped: true, reason: 'NO_RECIPIENTS' }

  const results = await Promise.allSettled(ids.map(id => sendMessage(id, text, opts)))
  return { ok: true, results }
}

async function sendToAdmins(text, opts = {}) {
  if (ADMIN_CHAT_IDS.length === 0) {
    console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_IDS empty – no recipients configured.')
    return { ok: false, skipped: true, reason: 'NO_ADMIN_CHAT_IDS' }
  }
  return sendToMany(ADMIN_CHAT_IDS, text, opts)
}

async function sendToGroupTransport(text, opts = {}) {
  if (!GROUP_TRANSPORT) return { ok: false, skipped: true, reason: 'NO_GROUP_TRANSPORT' }
  return sendMessage(GROUP_TRANSPORT, text, opts)
}

async function sendToGroupFood(text, opts = {}) {
  if (!GROUP_FOOD) return { ok: false, skipped: true, reason: 'NO_GROUP_FOOD' }
  return sendMessage(GROUP_FOOD, text, opts)
}

/**
 * ✅ Unified broadcaster for "group alerts":
 * Prefer FOOD group (if configured), otherwise fallback to ADMIN_CHAT_IDS.
 * This matches your old "sendToAll" expectation.
 */
async function sendToAll(text, opts = {}) {
  const r = await sendToGroupFood(text, opts)
  if (r?.ok) return r
  return sendToAdmins(text, opts)
}

/**
 * DM employee/driver/messenger (chat_id must already be saved in DB)
 * @param {string|number} employeeChatId
 * @param {string} text
 * @param {{silent?: boolean, [k: string]: any}} opts
 */
async function sendDM(employeeChatId, text, opts = {}) {
  if (!ENABLE_EMPLOYEE_DM) {
    return { ok: false, skipped: true, reason: 'DM_DISABLED' }
  }
  if (!employeeChatId) {
    return { ok: false, skipped: true, reason: 'NO_EMPLOYEE_CHAT_ID' }
  }

  const silent = typeof opts.silent === 'boolean' ? opts.silent : SILENT_DM_DEFAULT
  const { silent: _silent, ...rest } = opts

  return sendMessage(employeeChatId, text, {
    disable_notification: !!silent,
    ...rest,
  })
}

module.exports = {
  tgErr,
  sendMessage,
  sendToMany,
  sendToAdmins,
  sendToGroupTransport,
  sendToGroupFood,
  sendToAll, // ✅ added
  sendDM,
}
