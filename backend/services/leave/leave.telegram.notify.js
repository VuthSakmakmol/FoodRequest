// services/leave.telegram.notify.js
const User = require('../../models/User')

// Reuse existing transport Telegram sender, if present
let notifyFn = null
try {
  // same module carBooking uses: ../../services/transport.telegram.notify
  // relative from /services is './transport.telegram.notify'
  const transportNotify = require('./transport.telegram.notify')
  notifyFn = transportNotify?.notify || null
} catch {
  notifyFn = null
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'

function log(...args) {
  if (!isProd) console.log('[leave.notify]', ...args)
}

/**
 * Build a very simple manager message for a new leave request.
 */
function buildManagerText(doc) {
  const {
    employeeId,
    leaveTypeCode,
    startDate,
    endDate,
    totalDays,
    reason,
  } = doc

  const safeReason = String(reason || '').trim()
  const shortReason = safeReason ? (safeReason.length > 120 ? safeReason.slice(0, 117) + '…' : safeReason) : '—'

  return [
    '📅 *New Leave Request*',
    '',
    `👤 Employee: ${employeeId}`,
    `🏷 Type: ${leaveTypeCode}`,
    `🗓 Dates: ${startDate} → ${endDate} (${totalDays} day(s))`,
    '',
    `📝 Reason: ${shortReason}`,
  ].join('\n')
}

/**
 * Notify manager via Telegram when a new leave request is created.
 * - Find manager User by loginId
 * - Use their telegramChatId
 */
async function notifyNewLeaveToManager(doc) {
  if (!doc) return
  if (!notifyFn) {
    log('notifyNewLeaveToManager: notifyFn not available, skip.')
    return
  }

  const managerLoginId = String(doc.managerLoginId || '').trim()
  if (!managerLoginId) {
    log('notifyNewLeaveToManager: no managerLoginId on doc, skip.')
    return
  }

  const manager = await User.findOne({ loginId: managerLoginId, isActive: true })
    .select('loginId name telegramChatId')
    .lean()

  if (!manager) {
    log('notifyNewLeaveToManager: manager user not found:', managerLoginId)
    return
  }

  if (!manager.telegramChatId) {
    log('notifyNewLeaveToManager: manager has no telegramChatId:', managerLoginId)
    return
  }

  const text = buildManagerText(doc)
  await notifyFn(manager.telegramChatId, text, { parse_mode: 'Markdown' })

  log(`DM sent to manager=${managerLoginId} chatId=${manager.telegramChatId}`)
}

module.exports = {
  notifyNewLeaveToManager,
}
