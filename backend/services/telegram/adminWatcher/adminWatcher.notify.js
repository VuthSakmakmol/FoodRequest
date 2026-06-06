/* eslint-disable no-console */
// backend/services/telegram/adminWatcher/adminWatcher.notify.js
// Immediate Leave Admin watcher Telegram alerts only. No daily summary job.

const { sendDM } = require('../core/telegram.http')
const { resolveLeaveAdminWatcherChatIds } = require('./adminWatcher.recipients')
const { watcherRequestMessage } = require('./adminWatcher.messages')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function s(v) {
  return String(v ?? '').trim()
}

async function sendToLeaveAdmins(text, opts = {}) {
  const msg = s(text)
  if (!msg) return { ok: false, skipped: true, reason: 'NO_TEXT' }

  const chatIds = await resolveLeaveAdminWatcherChatIds()
  if (!chatIds.length) {
    if (DEBUG) console.warn('[adminWatcher.notify] no leave admin Telegram recipients')
    return { ok: false, skipped: true, reason: 'NO_RECIPIENTS' }
  }

  const results = await Promise.allSettled(
    chatIds.map((chatId) => sendDM(chatId, msg, opts))
  )

  const failed = results.filter((r) => r.status === 'rejected').length
  if (DEBUG) {
    console.log('[adminWatcher.notify] sent', {
      total: chatIds.length,
      failed,
      immediate: true,
      notification: 'loud',
    })
  }

  return { ok: failed < chatIds.length, total: chatIds.length, failed, results }
}

async function notifyLeaveAdminWatcher({ module, event, doc, actorLabel = '' }) {
  try {
    const text = watcherRequestMessage({ module, event, doc, actorLabel })

    // Leave Admin asked for immediate Telegram alerts all the time.
    // Do not silence middle approval updates here.
    return await sendToLeaveAdmins(text, { disable_notification: false })
  } catch (err) {
    console.error('[adminWatcher.notify] request alert failed:', err?.response?.data || err?.message)
    return { ok: false, error: err?.message }
  }
}

module.exports = {
  sendToLeaveAdmins,
  notifyLeaveAdminWatcher,
}
