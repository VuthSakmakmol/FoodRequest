// backend/services/telegram.polling.js
// Telegram polling listener (NO webhook) with MongoDB leader lock.
// ✅ Safe for multiple servers with same bot token: only ONE polls.
// ✅ New log strategy:
//    1) daily logs   -> logs/telegram/daily/YYYY-MM-DD.jsonl
//    2) all summary  -> logs/telegram/all/contacts.json

const TelegramBot = require('node-telegram-bot-api')
const mongoose = require('mongoose')
const crypto = require('crypto')
const os = require('os')
const axios = require('axios')
const fs = require('fs')
const path = require('path')

const { sendMessage, tgErr } = require('./telegram.service')

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()

const POLLING_ENABLED =
  String(process.env.TELEGRAM_POLLING_ENABLED || '').trim().toLowerCase() === 'true'

const AUTO_DELETE_WEBHOOK =
  String(process.env.TELEGRAM_AUTO_DELETE_WEBHOOK || 'true').trim().toLowerCase() === 'true'

const TELEGRAM_LOG_ROOT = path.resolve(process.cwd(), 'logs', 'telegram')
const TELEGRAM_DAILY_DIR = path.join(TELEGRAM_LOG_ROOT, 'daily')
const TELEGRAM_ALL_DIR = path.join(TELEGRAM_LOG_ROOT, 'all')
const TELEGRAM_ALL_CONTACTS_FILE = path.join(TELEGRAM_ALL_DIR, 'contacts.json')

// Leader lock tuning
const LEASE_MS = Number(process.env.TELEGRAM_POLLING_LEASE_MS || 30000)
const RENEW_EVERY_MS = Number(process.env.TELEGRAM_POLLING_RENEW_MS || 10000)
const STANDBY_CHECK_MS = Number(process.env.TELEGRAM_POLLING_STANDBY_MS || 5000)

// Polling config
const POLL_INTERVAL = Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 800)
const POLL_TIMEOUT = Number(process.env.TELEGRAM_POLL_TIMEOUT_SEC || 20)

const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : ''

let botInstance = null
let started = false
let lastErrAt = 0
let renewTimer = null
let standbyTimer = null

const OWNER_ID =
  `${os.hostname()}::pid=${process.pid}::` +
  crypto.randomBytes(6).toString('hex')

const TOKEN_KEY = BOT_TOKEN
  ? crypto.createHash('sha256').update(BOT_TOKEN).digest('hex')
  : 'NO_TOKEN'

/* ─────────────────────────────────────────────────────────────
 * DB Models (auto-detect)
 * ───────────────────────────────────────────────────────────── */
let EmployeeDirectory = null
try { EmployeeDirectory = require('../models/EmployeeDirectory') } catch {}

let Employee = null
try { Employee = require('../models/Employee') } catch {}

function getEmployeeModel() {
  return EmployeeDirectory || Employee || null
}

/* ─────────────────────────────────────────────────────────────
 * Mongo Lock Model
 * ───────────────────────────────────────────────────────────── */
function getLockModel() {
  if (mongoose.models?.TelegramPollingLock) return mongoose.models.TelegramPollingLock

  const schema = new mongoose.Schema(
    {
      _id: { type: String, required: true }, // TOKEN_KEY
      ownerId: { type: String, default: '' },
      lockUntil: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
    { collection: 'telegram_polling_locks' }
  )

  return mongoose.model('TelegramPollingLock', schema)
}

function dbReady() {
  return !!mongoose.connection && mongoose.connection.readyState === 1
}

async function ensureLockDocExists() {
  if (!dbReady()) return
  const Lock = getLockModel()
  try {
    await Lock.collection.insertOne({
      _id: TOKEN_KEY,
      ownerId: '',
      lockUntil: new Date(0),
      updatedAt: new Date(),
    })
  } catch (e) {
    const msg = String(e?.message || '')
    if (e?.code === 11000 || msg.includes('E11000')) return
    console.warn('⚠️ [TG] ensureLockDocExists error:', tgErr(e))
  }
}

async function acquireLock() {
  if (!dbReady()) return false
  if (!BOT_TOKEN) return false

  const Lock = getLockModel()
  const now = new Date()
  const newUntil = new Date(Date.now() + LEASE_MS)

  await ensureLockDocExists()

  const res = await Lock.updateOne(
    {
      _id: TOKEN_KEY,
      $or: [
        { lockUntil: { $lt: now } },
        { lockUntil: null },
        { ownerId: OWNER_ID },
      ],
    },
    {
      $set: {
        ownerId: OWNER_ID,
        lockUntil: newUntil,
        updatedAt: now,
      },
    }
  )

  const modified = res?.modifiedCount ?? res?.nModified ?? 0
  return modified > 0
}

async function renewLock() {
  if (!dbReady()) return false
  const Lock = getLockModel()

  const now = new Date()
  const newUntil = new Date(Date.now() + LEASE_MS)

  const res = await Lock.updateOne(
    { _id: TOKEN_KEY, ownerId: OWNER_ID },
    { $set: { lockUntil: newUntil, updatedAt: now } }
  )

  const modified = res?.modifiedCount ?? res?.nModified ?? 0
  return modified > 0
}

async function releaseLock() {
  if (!dbReady()) return
  const Lock = getLockModel()
  await Lock.updateOne(
    { _id: TOKEN_KEY, ownerId: OWNER_ID },
    { $set: { lockUntil: new Date(0), updatedAt: new Date(), ownerId: '' } }
  )
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────── */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function safeFileName(s) {
  return String(s).replace(/[^\w.-]/g, '_')
}

function ymd(dateLike = new Date()) {
  const d = new Date(dateLike)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isoNow() {
  return new Date().toISOString()
}

function s(v) {
  return String(v ?? '').trim()
}

function compactText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function readJsonFileSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (e) {
    console.warn(`⚠️ [TG] readJsonFileSafe failed for ${filePath}:`, tgErr(e))
    return fallback
  }
}

function writeJsonFileSafe(filePath, data) {
  try {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
    return true
  } catch (e) {
    console.error(`❌ [TG] writeJsonFileSafe failed for ${filePath}:`, tgErr(e))
    return false
  }
}

function extractMessageSummary(msg) {
  const chatId = s(msg?.chat?.id)
  const from = msg?.from || {}
  const text = compactText(msg?.text || '')
  const savedAt = isoNow()

  return {
    savedAt,
    dateKey: ymd(savedAt),
    chatId,
    chatType: s(msg?.chat?.type),
    messageId: Number(msg?.message_id || 0) || null,

    username: s(from?.username),
    firstName: s(from?.first_name),
    lastName: s(from?.last_name),
    fullName: compactText(`${s(from?.first_name)} ${s(from?.last_name)}`),

    text,

    isBot: !!from?.is_bot,
  }
}

function appendDailyTelegramLog(summary, rawUpdate) {
  try {
    ensureDir(TELEGRAM_DAILY_DIR)

    const filePath = path.join(
      TELEGRAM_DAILY_DIR,
      `${safeFileName(summary.dateKey)}.jsonl`
    )

    const record = {
      ...summary,
      update: rawUpdate,
    }

    fs.appendFile(filePath, JSON.stringify(record) + '\n', (err) => {
      if (err) {
        console.error('❌ [TG] appendDailyTelegramLog failed:', err.message)
      }
    })
  } catch (e) {
    console.error('❌ [TG] appendDailyTelegramLog error:', tgErr(e))
  }
}

function updateAllContactsSummary(summary) {
  try {
    ensureDir(TELEGRAM_ALL_DIR)

    const list = readJsonFileSafe(TELEGRAM_ALL_CONTACTS_FILE, [])
    const rows = Array.isArray(list) ? list : []

    const idx = rows.findIndex((r) => s(r?.chatId) === summary.chatId)
    if (idx >= 0) {
      const prev = rows[idx] || {}
      rows[idx] = {
        ...prev,
        chatId: summary.chatId,
        chatType: summary.chatType || prev.chatType || '',
        username: summary.username || prev.username || '',
        firstName: summary.firstName || prev.firstName || '',
        lastName: summary.lastName || prev.lastName || '',
        fullName: summary.fullName || prev.fullName || '',

        firstSeenAt: prev.firstSeenAt || summary.savedAt,
        lastSeenAt: summary.savedAt,

        lastText: summary.text || '',
        lastMessageId: summary.messageId || null,

        messageCount: Number(prev.messageCount || 0) + 1,

        // Manual fields for admin use later
        linkedEmployeeId: s(prev.linkedEmployeeId),
        linkedEmployeeName: s(prev.linkedEmployeeName),
        manualChecked: !!prev.manualChecked,
        note: s(prev.note),
      }
    } else {
      rows.push({
        chatId: summary.chatId,
        chatType: summary.chatType || '',
        username: summary.username || '',
        firstName: summary.firstName || '',
        lastName: summary.lastName || '',
        fullName: summary.fullName || '',

        firstSeenAt: summary.savedAt,
        lastSeenAt: summary.savedAt,

        lastText: summary.text || '',
        lastMessageId: summary.messageId || null,

        messageCount: 1,

        // Manual fields for admin use later
        linkedEmployeeId: '',
        linkedEmployeeName: '',
        manualChecked: false,
        note: '',
      })
    }

    rows.sort((a, b) => {
      const ta = new Date(a?.lastSeenAt || 0).getTime()
      const tb = new Date(b?.lastSeenAt || 0).getTime()
      return tb - ta
    })

    writeJsonFileSafe(TELEGRAM_ALL_CONTACTS_FILE, rows)
  } catch (e) {
    console.error('❌ [TG] updateAllContactsSummary error:', tgErr(e))
  }
}

function logTelegramUpdate(msg) {
  try {
    const summary = extractMessageSummary(msg)
    if (!summary.chatId) return

    appendDailyTelegramLog(summary, msg)
    updateAllContactsSummary(summary)
  } catch (e) {
    console.error('❌ [TG] logTelegramUpdate error:', tgErr(e))
  }
}

function parseStartPayload(text) {
  const raw = s(text)
  if (!raw.startsWith('/start')) return null
  const parts = raw.split(/\s+/)
  return parts[1] ? s(parts[1]) : null
}

async function saveEmployeeTelegramChatId(employeeId, chatId, from = {}) {
  const Model = getEmployeeModel()
  if (!Model) {
    console.warn('⚠️ [TG] No employee model found. ChatId not saved.')
    return { ok: false, reason: 'NO_MODEL' }
  }

  const empId = s(employeeId)
  if (!empId) return { ok: false, reason: 'NO_EMPLOYEE_ID' }

  const filter = { employeeId: empId }
  const update = {
    $set: {
      telegramChatId: s(chatId),
      telegramUsername: s(from.username),
      telegramFirstName: s(from.first_name),
      telegramLastName: s(from.last_name),
      telegramUpdatedAt: new Date(),
    },
  }

  try {
    const res = await Model.updateOne(filter, update)
    const matched = res?.matchedCount ?? res?.n ?? 0
    if (!matched) return { ok: false, reason: 'EMPLOYEE_NOT_FOUND' }
    return { ok: true }
  } catch (e) {
    console.error('❌ [TG] saveEmployeeTelegramChatId error:', tgErr(e))
    return { ok: false, reason: 'DB_ERROR' }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Polling lifecycle
 * ───────────────────────────────────────────────────────────── */
async function stopTelegramPolling() {
  clearInterval(renewTimer)
  renewTimer = null
  clearTimeout(standbyTimer)
  standbyTimer = null

  try {
    if (botInstance) {
      try { await botInstance.stopPolling() } catch (_) {}
      try { botInstance.removeAllListeners() } catch (_) {}
    }
  } finally {
    botInstance = null
    started = false
  }
}

async function ensureWebhookCleared() {
  if (!AUTO_DELETE_WEBHOOK) return
  if (!BOT_TOKEN || !API_BASE) return
  try {
    await axios.get(`${API_BASE}/deleteWebhook`, {
      params: { drop_pending_updates: true }
    })
  } catch (e) {
    console.warn('⚠️ [TG] deleteWebhook warning:', tgErr(e))
  }
}

function startBotInstance() {
  const AUTO_REPLY_TEXT =
    '👋 Welcome to Trax Apparel Cambodia.\n\n' +
    'Instruction:\n' +
    '- This chat robot is for notification only!\n' +
    '- Please do not reply to this robot.\n' +
    '- When you succeed login, please change your initial password.\n' +
    '============================\n' +
    'This is your initial Account.\n' +
    '- Your ID card number : 5252.....\n' +
    '- Password : FirstPassword@123\n' +
    '============================\n' +
    'please click this link to see our services.\n' +
    'http://178.128.48.101:4333/'

  botInstance = new TelegramBot(BOT_TOKEN, {
    polling: { interval: POLL_INTERVAL, params: { timeout: POLL_TIMEOUT } },
  })

  botInstance.on('message', async (msg) => {
    try {
      const chatId = msg?.chat?.id
      if (!chatId) return
      if (msg?.from?.is_bot) return

      // ✅ New logging strategy
      logTelegramUpdate(msg)

      const text = s(msg?.text)

      if (text === '/id' || text === '/chatid') {
        await sendMessage(chatId, `🆔 Your chat id is: <code>${chatId}</code>`)
        return
      }

      if (text === '/whoami') {
        const u = msg?.from || {}
        await sendMessage(
          chatId,
          `👤 <b>User</b>\n` +
          `- id: <code>${u.id || ''}</code>\n` +
          `- username: <code>${u.username || ''}</code>\n` +
          `- name: <code>${(u.first_name || '') + ' ' + (u.last_name || '')}</code>\n` +
          `- chatId: <code>${chatId}</code>`
        )
        return
      }

      // Keep this block only if you still want manual /start EMP001 linking later.
      // It does not auto-link by itself unless user sends /start EMP001.
      const payload = parseStartPayload(text)
      if (payload) {
        const r = await saveEmployeeTelegramChatId(payload, chatId, msg?.from || {})
        if (r.ok) {
          await sendMessage(chatId, '✅ Linked successfully! You will receive notifications here.')
        } else if (r.reason === 'EMPLOYEE_NOT_FOUND') {
          await sendMessage(chatId, '⚠️ Employee ID not found. Please contact admin.')
        } else {
          await sendMessage(chatId, '⚠️ Link failed. Please contact admin.')
        }
        return
      }

      await sendMessage(chatId, AUTO_REPLY_TEXT)
    } catch (e) {
      console.error('❌ [TG] message handler error:', tgErr(e))
    }
  })

  botInstance.on('polling_error', async (e) => {
    const m = tgErr(e)
    const low = String(m).toLowerCase()

    if (low.includes('409') || low.includes('conflict')) {
      const now = Date.now()
      if (now - lastErrAt > 2000) {
        console.error('❌ [TG] 409 Conflict. Another poller is active. Going standby.')
        lastErrAt = now
      }
      await stopTelegramPolling()
      await releaseLock().catch(() => {})
      scheduleStandby()
      return
    }

    const now = Date.now()
    if (now - lastErrAt > 2000) {
      console.error('❌ [TG] polling_error:', m)
      lastErrAt = now
    }
  })
}

function scheduleStandby() {
  clearTimeout(standbyTimer)
  standbyTimer = setTimeout(() => {
    runLeaderLoop().catch((e) => {
      console.error('❌ [TG] standby loop error:', tgErr(e))
      scheduleStandby()
    })
  }, STANDBY_CHECK_MS)
}

async function runLeaderLoop() {
  if (!POLLING_ENABLED) {
    console.log('ℹ️ [TG] Polling disabled.')
    return
  }
  if (!BOT_TOKEN) {
    console.log('ℹ️ [TG] TELEGRAM_BOT_TOKEN missing.')
    return
  }

  let got = false
  try {
    got = await acquireLock()
  } catch (e) {
    console.warn('⚠️ [TG] acquireLock failed:', tgErr(e))
    got = false
  }

  if (!got) {
    if (started) await stopTelegramPolling()
    console.log('🟡 [TG] Standby (another server is polling).')
    scheduleStandby()
    return
  }

  if (!started) {
    started = true
    await ensureWebhookCleared()
    startBotInstance()
    console.log('✅ [TG] Polling started as LEADER:', OWNER_ID)
  }

  clearInterval(renewTimer)
  renewTimer = setInterval(async () => {
    try {
      const ok = await renewLock()
      if (!ok) {
        console.error('❌ [TG] Lost leader lock. Stopping polling and standby.')
        await stopTelegramPolling()
        scheduleStandby()
      }
    } catch (e) {
      console.error('❌ [TG] renewLock error:', tgErr(e))
      await stopTelegramPolling()
      scheduleStandby()
    }
  }, RENEW_EVERY_MS)
}

function bindGracefulShutdown() {
  if (bindGracefulShutdown._bound) return
  bindGracefulShutdown._bound = true

  const shutdown = async () => {
    try { await stopTelegramPolling() } catch (_) {}
    try { await releaseLock() } catch (_) {}
  }

  process.once('SIGINT', async () => {
    await shutdown()
    process.exit(0)
  })
  process.once('SIGTERM', async () => {
    await shutdown()
    process.exit(0)
  })
  process.once('SIGUSR2', async () => {
    await shutdown()
    process.kill(process.pid, 'SIGUSR2')
  })
}

function startTelegramPolling() {
  if (!POLLING_ENABLED) {
    console.log('ℹ️ [TG] Polling disabled (TELEGRAM_POLLING_ENABLED=false).')
    return { stop: stopTelegramPolling }
  }
  if (!BOT_TOKEN) {
    console.log('ℹ️ [TG] Polling: TELEGRAM_BOT_TOKEN missing, skip.')
    return { stop: stopTelegramPolling }
  }

  ensureDir(TELEGRAM_LOG_ROOT)
  ensureDir(TELEGRAM_DAILY_DIR)
  ensureDir(TELEGRAM_ALL_DIR)

  if (!fs.existsSync(TELEGRAM_ALL_CONTACTS_FILE)) {
    writeJsonFileSafe(TELEGRAM_ALL_CONTACTS_FILE, [])
  }

  runLeaderLoop().catch((e) => {
    console.error('❌ [TG] leader loop failed:', tgErr(e))
    scheduleStandby()
  })

  bindGracefulShutdown()
  return { stop: stopTelegramPolling }
}

module.exports = {
  startTelegramPolling,
  stopTelegramPolling,
  saveEmployeeTelegramChatId,
}