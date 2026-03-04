/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.notify.js
//
// ✅ NO admin DMs anymore (leave_admin/admin/root_admin receive NOTHING)
// ✅ Employee gets submit + decision + cancel DMs
// ✅ Current approver gets DM
// ✅ FYI read-only:
//    - MANAGER_ONLY: GM gets FYI even though not involved
//    - GM_ONLY: COO gets FYI even though not involved

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const rec = require('./leave.telegram.recipients')
const msg = require('./leave.telegram.messages')
const { sendLeaveDM } = require('./leave.telegram.service')

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

/* Create: employee confirm */
async function notifyCreatedToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  await sendLeaveDM(chatId, msg.employeeSubmitted(doc))
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
        await sendLeaveDM(gmChatId, msg.gmNew(doc, employeeName)) // gmNew() will show FYI
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
        await sendLeaveDM(cooChatId, msg.cooNew(doc, employeeName)) // cooNew() will show FYI
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

/* Decisions: employee only (NO admin DMs) */
async function notifyManagerDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  await sendLeaveDM(chatId, msg.employeeDecision(doc, 'Manager'))
}
async function notifyGmDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  await sendLeaveDM(chatId, msg.employeeDecision(doc, 'GM'))
}
async function notifyCooDecisionToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  await sendLeaveDM(chatId, msg.employeeDecision(doc, 'COO'))
}

/* Cancel: employee */
async function notifyCancelledToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  const pseudo = { ...doc, status: 'CANCELLED' }
  await sendLeaveDM(chatId, msg.employeeDecision(pseudo, 'System'))
}

module.exports = {
  notifyCreatedToEmployee,
  notifyCurrentApprover,

  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  notifyCancelledToEmployee,
}