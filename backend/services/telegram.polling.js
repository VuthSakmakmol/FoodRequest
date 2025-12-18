// backend/services/telegram.polling.js
const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const path = require('path')

let botInstance = null

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function safeFileName(s) {
  return String(s).replace(/[^\w.-]/g, '_')
}

function appendUpdateToFile({ chatId, update }) {
  const baseDir = path.resolve(process.cwd(), 'logs', 'telegram')
  ensureDir(baseDir)

  // one file per chatId
  const filePath = path.join(baseDir, `${safeFileName(chatId)}.jsonl`)

  const record = {
    savedAt: new Date().toISOString(),
    chatId: String(chatId),
    update, // full Telegram message object
  }

  fs.appendFile(filePath, JSON.stringify(record) + '\n', (err) => {
    if (err) console.error('❌ write telegram log failed:', err.message)
  })
}

async function clearWebhook(token) {
  // Helps ensure polling works even if webhook was set before
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
    })
  } catch (_) {
    // ignore
  }
}

function startTelegramPolling() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  if (!token) {
    console.log('ℹ️ Telegram polling: TELEGRAM_BOT_TOKEN missing, skip.')
    return { stop: async () => {} }
  }

  // Prevent double-start (nodemon restarts, etc.)
  if (botInstance) {
    console.log('ℹ️ Telegram polling already started, skip.')
    return { stop: async () => {} }
  }

  const AUTO_REPLY_TEXT =
    '👋 Welcome to Trax Apparel Cambodia.\n\n' +
    'Instruction: \n' +
    '- This Chat Robotis using for notification only! \n' +
    '- Please be aware that do not reply this robot! \n' +
    '====================================== \n' +
    'Click this link to see our services:\n' +
    'http://178.128.48.101:4333/'

  // clear webhook (so polling can receive updates)
  clearWebhook(token)

  const bot = new TelegramBot(token, { polling: true })
  botInstance = bot

  // ✅ Reply to EVERY message + save every update to file
  bot.on('message', async (msg) => {
    try {
      if (!msg?.chat?.id) return
      if (msg?.from?.is_bot) return

      // Save update JSON (per chatId)
      appendUpdateToFile({ chatId: msg.chat.id, update: msg })

      // Reply same message every time
      await bot.sendMessage(msg.chat.id, AUTO_REPLY_TEXT, {
        disable_web_page_preview: true,
      })
    } catch (e) {
      console.error('❌ Telegram handler error:', e?.message || e)
    }
  })

  bot.on('polling_error', (e) => {
    console.error('❌ Telegram polling_error:', e?.message || e)
  })

  console.log('✅ Telegram polling started (auto-reply + file logging enabled)')
  return {
    stop: async () => {
      try { await bot.stopPolling() } catch (_) {}
      botInstance = null
    },
  }
}

module.exports = { startTelegramPolling }
