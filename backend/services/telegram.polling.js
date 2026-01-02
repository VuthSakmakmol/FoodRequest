// backend/services/telegram.polling.js
// Telegram polling listener (NO webhook).
// IMPORTANT: Only ONE process in your whole world should poll with the same bot token.
// Use TELEGRAM_POLLING_ENABLED=true only in ONE app (or one special listener service).
//
// This file logs updates AND supports deep-link binding:
//   https://t.me/<BotUserName>?start=<employeeId>
// It saves msg.chat.id into employee.telegramChatId (Mongo) for future DM sending.

const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const path = require('path')

const { sendMessage, tgErr } = require('./telegram.service')

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
const POLLING_ENABLED =
  String(process.env.TELEGRAM_POLLING_ENABLED || '').trim().toLowerCase() === 'true'

// Optional: change where logs go
const LOG_DIR = path.resolve(process.cwd(), 'logs', 'telegram')

let botInstance = null
let started = false
let lastErrAt = 0

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
    const record = {
      savedAt: new Date().toISOString(),
      chatId: String(chatId),
      update,
    }
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
    console.warn('⚠️ [TG] No employee model found (EmployeeDirectory/Employee). ChatId not saved.')
    return { ok: false, reason: 'NO_MODEL' }
  }

  const empId = String(employeeId || '').trim()
  if (!empId) return { ok: false, reason: 'NO_EMPLOYEE_ID' }

  // ✅ Adjust this filter if your schema uses another field name
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
    if (!matched) {
      console.warn('⚠️ [TG] employeeId not found for binding:', empId)
      return { ok: false, reason: 'EMPLOYEE_NOT_FOUND' }
    }
    return { ok: true }
  } catch (e) {
    console.error('❌ [TG] saveEmployeeTelegramChatId error:', tgErr(e))
    return { ok: false, reason: 'DB_ERROR' }
  }
}

async function stopTelegramPolling() {
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

function startTelegramPolling() {
  if (!POLLING_ENABLED) {
    console.log('ℹ️ [TG] Polling disabled (TELEGRAM_POLLING_ENABLED=false).')
    return { stop: stopTelegramPolling }
  }

  if (!BOT_TOKEN) {
    console.log('ℹ️ [TG] Polling: TELEGRAM_BOT_TOKEN missing, skip.')
    return { stop: stopTelegramPolling }
  }

  if (started || botInstance) {
    console.log('ℹ️ [TG] Polling already started, skip.')
    return { stop: stopTelegramPolling }
  }

  started = true

  const AUTO_REPLY_TEXT =
    '👋 Welcome to Trax Apparel Cambodia.\n\n' +
    'Instruction:\n' +
    '- This chat robot is for notification only!\n' +
    '- Please do not reply to this robot.\n' +
    '======================================\n' +
    'please click this link to see our services.\n' +
    'http://178.128.48.101:4333/'

  // Safer polling config
  botInstance = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 800,
      params: { timeout: 20 },
    },
  })

  botInstance.on('message', async (msg) => {
    try {
      const chatId = msg?.chat?.id
      if (!chatId) return
      if (msg?.from?.is_bot) return

      logUpdate(chatId, msg)

      const text = String(msg?.text || '').trim()

      // quick helpers for admins/users to get IDs
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

      // Deep-link binding: /start <employeeId>
      const payload = parseStartPayload(text)
      if (payload) {
        const r = await saveEmployeeTelegramChatId(payload, chatId, msg?.from || {})
        if (r.ok) {
          await sendMessage(chatId, '✅ Linked successfully! You will receive notifications here.')
        } else if (r.reason === 'EMPLOYEE_NOT_FOUND') {
          await sendMessage(chatId, '⚠️ Employee ID not found. Please contact admin to verify your Employee ID.')
        } else {
          await sendMessage(chatId, '⚠️ Link failed. Please contact admin.')
        }
        return
      }

      // default auto reply
      await sendMessage(chatId, AUTO_REPLY_TEXT)
    } catch (e) {
      console.error('❌ [TG] message handler error:', tgErr(e))
    }
  })

  botInstance.on('polling_error', async (e) => {
    const m = tgErr(e)
    const low = String(m).toLowerCase()

    // 409 conflict => another poller running OR webhook still set somewhere
    if (low.includes('409') || low.includes('conflict')) {
      const now = Date.now()
      if (now - lastErrAt > 4000) {
        console.error('❌ [TG] polling_error: 409 Conflict. Stopping polling to prevent spam.')
        lastErrAt = now
      }
      await stopTelegramPolling()
      return
    }

    // rate-limit other spammy errors
    const now = Date.now()
    if (now - lastErrAt > 2000) {
      console.error('❌ [TG] polling_error:', m)
      lastErrAt = now
    }
  })

  console.log('✅ [TG] Polling started (no webhook)')
  return { stop: stopTelegramPolling }
}

module.exports = {
  startTelegramPolling,
  stopTelegramPolling,
  saveEmployeeTelegramChatId, // exported in case you want to call manually
}
