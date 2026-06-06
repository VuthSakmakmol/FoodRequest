/* eslint-disable no-console */
// backend/services/telegram/adminWatcher/adminWatcher.recipients.js
// Resolve Telegram recipients for Leave Admin watcher alerts.
// Source:
//   1) active users with LEAVE_ADMIN / ADMIN / ROOT_ADMIN role
//   2) optional env LEAVE_ADMIN_TELEGRAM_CHAT_IDS or TELEGRAM_ADMIN_CHAT_IDS

const User = require('../../../models/User')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const WATCHER_ROLES = ['LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN']

function s(v) {
  return String(v ?? '').trim()
}

function splitIds(v) {
  return s(v)
    .split(',')
    .map((x) => s(x))
    .filter(Boolean)
}

function uniq(arr) {
  return [...new Set((arr || []).map((x) => s(x)).filter(Boolean))]
}

async function resolveLeaveAdminWatcherChatIds() {
  const envIds = [
    ...splitIds(process.env.LEAVE_ADMIN_TELEGRAM_CHAT_IDS),
    ...splitIds(process.env.TELEGRAM_ADMIN_CHAT_IDS),
  ]

  try {
    const users = await User.find(
      {
        isActive: { $ne: false },
        telegramChatId: { $exists: true, $nin: ['', null] },
        $or: [{ role: { $in: WATCHER_ROLES } }, { roles: { $in: WATCHER_ROLES } }],
      },
      { loginId: 1, role: 1, roles: 1, telegramChatId: 1 }
    ).lean()

    const dbIds = (users || []).map((u) => s(u.telegramChatId)).filter(Boolean)
    const ids = uniq([...envIds, ...dbIds])

    if (DEBUG) {
      console.log('[adminWatcher.recipients] resolved', {
        envCount: envIds.length,
        dbCount: dbIds.length,
        total: ids.length,
      })
    }

    return ids
  } catch (err) {
    console.error('[adminWatcher.recipients] resolve failed:', err?.message)
    return uniq(envIds)
  }
}

module.exports = {
  resolveLeaveAdminWatcherChatIds,
}
