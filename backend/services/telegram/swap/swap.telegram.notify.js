/* eslint-disable no-console */
// backend/services/telegram/swap/swap.telegram.notify.js
//
// ✅ Employee gets submit + decision + cancel DMs
// ✅ Current approver gets DM
// ✅ Leave Admin watcher gets submitted/progress/final approved/rejected/cancelled
// ✅ Leave Admin watcher gets every important update immediately with normal Telegram notification

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const msg = require('./swap.telegram.messages')
const rec = require('./swap.telegram.recipients')
const { sendSwapDM } = require('./swap.telegram.service')
const adminWatcher = require('../adminWatcher')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
function log(...args) {
  if (DEBUG) console.log('[swap.notify]', ...args)
}
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

/* get employee display name */
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
      module: 'SWAP',
      event,
      doc,
      actorLabel,
      silent,
    })
  } catch (err) {
    console.warn('[swap.notify] admin watcher failed:', err?.response?.data || err?.message)
  }
}

/* ─────────────────────────────
 * Employee submit confirmation + leave admin watcher
 * ───────────────────────────── */
async function notifySwapRequestCreated(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (chatId) {
      await sendSwapDM(chatId, msg.employeeSubmitted(doc))
    } else {
      log('skip employee submitted (no chatId)', doc.employeeId)
    }
    await notifyAdminWatcher('SUBMITTED', doc, doc?.requesterLoginId || 'Employee', false)
  } catch (err) {
    console.error('[swap.notify] notifySwapRequestCreated error:', err.message)
  }
}

/* ─────────────────────────────
 * Approver inbox DMs
 * ───────────────────────────── */
async function notifySwapToManager(doc, opts = {}) {
  try {
    if (!doc) return
    const chatId = await rec.resolveManagerChatId(doc)
    if (!chatId) return log('skip manager (no chatId)', doc.managerLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.managerNewSwap(doc, employeeName), opts)
  } catch (err) {
    console.error('[swap.notify] notifySwapToManager error:', err.message)
  }
}

async function notifySwapToGm(doc, opts = {}) {
  try {
    if (!doc) return
    const chatId = await rec.resolveGmChatId(doc)
    if (!chatId) return log('skip gm (no chatId)', doc.gmLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.gmNewSwap(doc, employeeName), opts)
  } catch (err) {
    console.error('[swap.notify] notifySwapToGm error:', err.message)
  }
}

async function notifySwapToCoo(doc, opts = {}) {
  try {
    if (!doc) return
    const chatId = await rec.resolveCooChatId(doc)
    if (!chatId) return log('skip coo (no chatId)', doc.cooLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.cooNewSwap(doc, employeeName), opts)
  } catch (err) {
    console.error('[swap.notify] notifySwapToCoo error:', err.message)
  }
}

/**
 * Notify current approver based on STATUS (queue-style)
 *
 * ✅ AND add FYI read-only logic:
 * - PENDING_MANAGER + MANAGER_ONLY => send GM FYI silently
 * - PENDING_GM + GM_ONLY          => send COO FYI silently
 */
async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return
    const st = up(doc.status)
    const mode = up(doc.approvalMode)

    // ✅ explicit final guards (clean + safe)
    if (st === 'APPROVED' || st === 'REJECTED' || st === 'CANCELLED') return

    // 1) Normal action DM to current approver
    if (st === 'PENDING_MANAGER') {
      await notifySwapToManager(doc)
    } else if (st === 'PENDING_GM') {
      await notifySwapToGm(doc)
    } else if (st === 'PENDING_COO') {
      await notifySwapToCoo(doc)
    } else {
      if (DEBUG) log('skip notifyCurrentApprover (unknown status)', st, doc?._id)
      return
    }

    // 2) FYI (read-only) mirror from Leave
    // MANAGER_ONLY -> GM gets FYI while manager is final approver
    if (st === 'PENDING_MANAGER' && mode === 'MANAGER_ONLY') {
      await notifySwapToGm(doc, { disable_notification: true }) // gmNewSwap() will render FYI wording
    }

    // GM_ONLY -> COO gets FYI while GM is final approver
    if (st === 'PENDING_GM' && mode === 'GM_ONLY') {
      await notifySwapToCoo(doc, { disable_notification: true }) // cooNewSwap() will render FYI wording
    }
  } catch (err) {
    console.error('[swap.notify] notifyCurrentApprover error:', err.message)
  }
}

/* ─────────────────────────────
 * Decision → Employee + leave admin watcher
 * ───────────────────────────── */
async function notifyManagerDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (chatId) {
      await sendSwapDM(chatId, msg.employeeDecision(doc, 'Manager'))
    }
    const adminEvent = adminEventForDecision(doc)
    await notifyAdminWatcher(adminEvent.event, doc, 'Manager', adminEvent.silent)
  } catch (err) {
    console.error('[swap.notify] notifyManagerDecisionToEmployee error:', err.message)
  }
}

async function notifyGmDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (chatId) {
      await sendSwapDM(chatId, msg.employeeDecision(doc, 'GM'))
    }
    const adminEvent = adminEventForDecision(doc)
    await notifyAdminWatcher(adminEvent.event, doc, 'GM', adminEvent.silent)
  } catch (err) {
    console.error('[swap.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

async function notifyCooDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (chatId) {
      await sendSwapDM(chatId, msg.employeeDecision(doc, 'COO'))
    }
    const adminEvent = adminEventForDecision(doc)
    await notifyAdminWatcher(adminEvent.event, doc, 'COO', adminEvent.silent)
  } catch (err) {
    console.error('[swap.notify] notifyCooDecisionToEmployee error:', err.message)
  }
}

/* Cancel notice */
async function notifySwapCancelledToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    const pseudo = { ...doc, status: 'CANCELLED' }
    if (chatId) {
      await sendSwapDM(chatId, msg.employeeDecision(pseudo, 'System'))
    }
    await notifyAdminWatcher('CANCELLED', pseudo, doc?.cancelledBy || 'System', false)
  } catch (err) {
    console.error('[swap.notify] notifySwapCancelledToEmployee error:', err.message)
  }
}

module.exports = {
  // create
  notifySwapRequestCreated,
  notifyCurrentApprover,

  // approver inbox DMs
  notifySwapToManager,
  notifySwapToGm,
  notifySwapToCoo,

  // requester decision DMs
  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  // optional
  notifySwapCancelledToEmployee,
}
