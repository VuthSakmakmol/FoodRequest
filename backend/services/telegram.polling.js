const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const path = require('path')

let botInstance = null
let started = false
let last409 = 0

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function safeFileName(s) {
  return String(s).replace(/[^\w.-]/g, '_')
}

function appendUpdateToFile({ chatId, update }) {
  const baseDir = path.resolve(process.cwd(), 'logs', 'telegram')
  ensureDir(baseDir)

  const filePath = path.join(baseDir, `${safeFileName(chatId)}.jsonl`)
  const record = {
    savedAt: new Date().toISOString(),
    chatId: String(chatId),
    update,
  }

  fs.appendFile(filePath, JSON.stringify(record) + '\n', (err) => {
    if (err) console.error('❌ write telegram log failed:', err.message)
  })
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
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  if (!token) {
    console.log('ℹ️ Telegram polling: TELEGRAM_BOT_TOKEN missing, skip.')
    return { stop: stopTelegramPolling }
  }

  if (started || botInstance) {
    console.log('ℹ️ Telegram polling already started, skip.')
    return { stop: stopTelegramPolling }
  }
  started = true

  const AUTO_REPLY_TEXT =
    '👋 Welcome to Trax Apparel Cambodia.\n\n' +
    'Instruction:\n' +
    '- This chat robot is for notification only!\n' +
    '- Please do not reply to this robot.\n' +
    '======================================\n' +
    'Click this link to see our services:\n' +
    'http://178.128.48.101:4333/'

  const bot = new TelegramBot(token, { polling: true })
  botInstance = bot

  bot.on('message', async (msg) => {
    try {
      if (!msg?.chat?.id) return
      if (msg?.from?.is_bot) return

      appendUpdateToFile({ chatId: msg.chat.id, update: msg })

      await bot.sendMessage(msg.chat.id, AUTO_REPLY_TEXT, {
        disable_web_page_preview: true,
      })
    } catch (e) {
      console.error('❌ Telegram handler error:', e?.message || e)
    }
  })

  bot.on('polling_error', (e) => {
    const m = e?.message || ''
    if (m.includes('409') || m.toLowerCase().includes('conflict')) {
      const now = Date.now()
      if (now - last409 > 5000) {
        console.error('❌ Telegram polling_error: 409 Conflict (another poller is running somewhere)')
        last409 = now
      }
      return
    }
    console.error('❌ Telegram polling_error:', m)
  })

  console.log('✅ Telegram polling started (log-only, no webhook)')
  return { stop: stopTelegramPolling }
}

module.exports = { startTelegramPolling, stopTelegramPolling }
