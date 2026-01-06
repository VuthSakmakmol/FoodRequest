// backend/services/telegram.polling.js
// Telegram polling listener (NO webhook) with MongoDB leader lock.
// ✅ Safe for multiple servers with same bot token: only ONE polls.

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

const LOG_DIR = path.resolve(process.cwd(), 'logs', 'telegram')

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
    // Insert once; ignore if already exists
    await Lock.collection.insertOne({
      _id: TOKEN_KEY,
      ownerId: '',
      lockUntil: new Date(0),
      updatedAt: new Date(),
    })
  } catch (e) {
    // 11000 means it already exists -> OK
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

  // Ensure doc exists FIRST to avoid upsert-duplicate race
  await ensureLockDocExists()

  // Try acquire if expired OR already ours (NO upsert here)
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
function logUpdate(chatId, update) {
  try {
    ensureDir(LOG_DIR)
    const filePath = path.join(LOG_DIR, `${safeFileName(chatId)}.jsonl`)
    const record = { savedAt: new Date().toISOString(), chatId: String(chatId), update }
    fs.appendFile(filePath, JSON.stringify(record) + '\n', (err) => {
      if (err) console.error('❌ [TG] write telegram log failed:', err.message)
    })
  } catch (e) {
    console.error('❌ [TG] logUpdate error:', tgErr(e))
  }
}
function parseStartPayload(text) {
  const raw = String(text || '').trim()
  if (!raw.startsWith('/start')) return null
  const parts = raw.split(/\s+/)
  return parts[1] ? String(parts[1]).trim() : null
}

async function saveEmployeeTelegramChatId(employeeId, chatId, from = {}) {
  const Model = getEmployeeModel()
  if (!Model) {
    console.warn('⚠️ [TG] No employee model found. ChatId not saved.')
    return { ok: false, reason: 'NO_MODEL' }
  }

  const empId = String(employeeId || '').trim()
  if (!empId) return { ok: false, reason: 'NO_EMPLOYEE_ID' }

  const filter = { employeeId: empId }
  const update = {
    $set: {
      telegramChatId: String(chatId),
      telegramUsername: String(from.username || ''),
      telegramFirstName: String(from.first_name || ''),
      telegramLastName: String(from.last_name || ''),
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
    '======================================\n' +
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

      logUpdate(chatId, msg)
      const text = String(msg?.text || '').trim()

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

      const payload = parseStartPayload(text)
      if (payload) {
        const r = await saveEmployeeTelegramChatId(payload, chatId, msg?.from || {})
        if (r.ok) await sendMessage(chatId, '✅ Linked successfully! You will receive notifications here.')
        else if (r.reason === 'EMPLOYEE_NOT_FOUND')
          await sendMessage(chatId, '⚠️ Employee ID not found. Please contact admin.')
        else
          await sendMessage(chatId, '⚠️ Link failed. Please contact admin.')
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
  try { got = await acquireLock() } catch (e) {
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
