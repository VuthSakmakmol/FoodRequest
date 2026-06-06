/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.notify.js
//
// ✅ Employee gets submit + decision + cancel DMs
// ✅ Current approver gets DM
// ✅ Leave Admin watcher gets submitted/progress/final approved/rejected/cancelled
// ✅ Leave Admin watcher gets every important update immediately with normal Telegram notification
// ✅ FYI read-only:
//    - MANAGER_ONLY: GM gets FYI even though not involved
//    - GM_ONLY: COO gets FYI even though not involved

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const rec = require('./leave.telegram.recipients')
const msg = require('./leave.telegram.messages')
const { sendLeaveDM } = require('./leave.telegram.service')
const adminWatcher = require('../adminWatcher')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
function log(...args) {
  if (DEBUG) console.log('[leave.notify]', ...args)
}
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

async function getEmployeeName(employeeId) {
  const empId = s(employeeId)
  if (!empId) return ''
  const emp = await EmployeeDirectory.findOne({ employeeId: empId }, { name: 1, fullName: 1 }).lean()
  return emp?.name || emp?.fullName || ''
}

function adminEventForDecision(doc) {
  const st = up(doc?.status)
  if (st === 'APPROVED') return { event: 'APPROVED_FINAL', silent: false }
  if (st === 'REJECTED') return { event: 'REJECTED', silent: false }
  if (st === 'CANCELLED' || st === 'CANCELED') return { event: 'CANCELLED', silent: false }
  if (st === 'PENDING_MANAGER' || st === 'PENDING_GM' || st === 'PENDING_COO') {
    return { event: 'STEP_APPROVED', silent: false }
  }
  return { event: 'UPDATED', silent: false }
}

async function notifyAdminWatcher(event, doc, actorLabel = '', silent = false) {
  try {
    await adminWatcher.notifyLeaveAdminWatcher({
      module: 'LEAVE',
      event,
      doc,
      actorLabel,
      silent,
    })
  } catch (err) {
    console.warn('[leave.notify] admin watcher failed:', err?.response?.data || err?.message)
  }
}

/* Create: employee confirm + leave admin watcher */
async function notifyCreatedToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (chatId) {
    await sendLeaveDM(chatId, msg.employeeSubmitted(doc))
  }
  await notifyAdminWatcher('SUBMITTED', doc, doc?.requesterLoginId || 'Employee', false)
}

/* Current approver: based on status + mode (includes FYI rules) */
async function notifyCurrentApprover(doc) {
  const st = up(doc?.status)
  const mode = up(doc?.approvalMode)
  const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId

  if (DEBUG) {
    console.log('[leave.notify] notifyCurrentApprover (enter)', {
      requestId: String(doc?._id || ''),
      status: st,
      mode,
      managerLoginId: String(doc?.managerLoginId || ''),
      gmLoginId: String(doc?.gmLoginId || ''),
      cooLoginId: String(doc?.cooLoginId || ''),
    })
  }

  // PENDING_MANAGER → Manager (action) + GM FYI if MANAGER_ONLY
  if (st === 'PENDING_MANAGER') {
    const managerChatId = await rec.resolveManagerChatId(doc)
    if (managerChatId) {
      await sendLeaveDM(managerChatId, msg.managerNew(doc, employeeName))
      log('sent manager DM', { requestId: String(doc?._id || ''), managerChatId })
    } else {
      log('skip manager DM (no chatId)', { requestId: String(doc?._id || ''), managerLoginId: String(doc?.managerLoginId || '') })
    }

    // ✅ GM FYI read-only
    if (mode === 'MANAGER_ONLY') {
      // (optional safety) fallback to fixed loginId if doc.gmLoginId empty
      const gmChatId = await rec.resolveGmChatId({ ...doc, gmLoginId: doc?.gmLoginId || 'leave_gm' })
      if (gmChatId) {
        await sendLeaveDM(gmChatId, msg.gmNew(doc, employeeName), { disable_notification: true }) // FYI should be quiet
        log('sent GM FYI DM', { requestId: String(doc?._id || ''), gmChatId })
      } else {
        log('skip GM FYI DM (no chatId)', { requestId: String(doc?._id || ''), gmLoginId: String(doc?.gmLoginId || '') })
      }
    }

    return
  }

  // PENDING_GM → GM (action) + COO FYI if GM_ONLY
  if (st === 'PENDING_GM') {
    const gmChatId = await rec.resolveGmChatId(doc)
    if (gmChatId) {
      await sendLeaveDM(gmChatId, msg.gmNew(doc, employeeName))
      log('sent GM DM', { requestId: String(doc?._id || ''), gmChatId })
    } else {
      log('skip GM DM (no chatId)', { requestId: String(doc?._id || ''), gmLoginId: String(doc?.gmLoginId || '') })
    }

    // ✅ COO FYI read-only
    if (mode === 'GM_ONLY') {
      // (optional safety) fallback to fixed loginId if doc.cooLoginId empty
      const cooChatId = await rec.resolveCooChatId({ ...doc, cooLoginId: doc?.cooLoginId || 'leave_coo' })
      if (cooChatId) {
        await sendLeaveDM(cooChatId, msg.cooNew(doc, employeeName), { disable_notification: true }) // FYI should be quiet
        log('sent COO FYI DM', { requestId: String(doc?._id || ''), cooChatId })
      } else {
        log('skip COO FYI DM (no chatId)', { requestId: String(doc?._id || ''), cooLoginId: String(doc?.cooLoginId || '') })
      }
    }

    return
  }

  // PENDING_COO → COO (action)
  if (st === 'PENDING_COO') {
    const cooChatId = await rec.resolveCooChatId(doc)
    if (!cooChatId) {
      return log('skip COO DM (no chatId)', { requestId: String(doc?._id || ''), cooLoginId: String(doc?.cooLoginId || '') })
    }
    await sendLeaveDM(cooChatId, msg.cooNew(doc, employeeName))
    log('sent COO DM', { requestId: String(doc?._id || ''), cooChatId })
    return
  }

  // For other statuses, do nothing
  log('notifyCurrentApprover: no action for status', { requestId: String(doc?._id || ''), status: st, mode })
}

/* Decisions: employee + leave admin watcher */
async function notifyManagerDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (chatId) {
    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'Manager'))
  }
  const adminEvent = adminEventForDecision(doc)
  await notifyAdminWatcher(adminEvent.event, doc, 'Manager', adminEvent.silent)
}
async function notifyGmDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (chatId) {
    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'GM'))
  }
  const adminEvent = adminEventForDecision(doc)
  await notifyAdminWatcher(adminEvent.event, doc, 'GM', adminEvent.silent)
}
async function notifyCooDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (chatId) {
    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'COO'))
  }
  const adminEvent = adminEventForDecision(doc)
  await notifyAdminWatcher(adminEvent.event, doc, 'COO', adminEvent.silent)
}

/* Cancel: employee + leave admin watcher */
async function notifyCancelledToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  const pseudo = { ...doc, status: 'CANCELLED' }
  if (chatId) {
    await sendLeaveDM(chatId, msg.employeeDecision(pseudo, 'System'))
  }
  await notifyAdminWatcher('CANCELLED', pseudo, doc?.cancelledBy || 'System', false)
}

module.exports = {
  notifyCreatedToEmployee,
  notifyCurrentApprover,

  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  notifyCancelledToEmployee,
}
