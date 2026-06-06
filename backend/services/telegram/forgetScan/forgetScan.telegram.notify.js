/* eslint-disable no-console */
// backend/services/telegram/forgetScan/forgetScan.telegram.notify.js
//
// ✅ Employee gets submit + decision + cancel DMs
// ✅ Current approver gets DM
// ✅ Leave Admin watcher gets submitted/progress/final approved/rejected/cancelled
// ✅ Leave Admin watcher gets every important update immediately with normal Telegram notification

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const msg = require('./forgetScan.telegram.messages')
const rec = require('./forgetScan.telegram.recipients')
const { sendForgetScanDM } = require('./forgetScan.telegram.service')
const adminWatcher = require('../adminWatcher')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
function log(...args) {
  if (DEBUG) console.log('[forgetscan.notify]', ...args)
}

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

const FIXED_GM = 'leave_gm'
const FIXED_COO = 'leave_coo'

async function getEmployeeName(employeeId) {
  const empId = s(employeeId)
  if (!empId) return ''
  const emp = await EmployeeDirectory.findOne({ employeeId: empId }, { name: 1, fullName: 1 }).lean()
  return emp?.name || emp?.fullName || ''
}

/* ✅ normalize doc to ensure gmLoginId/cooLoginId always exist when needed */
function normalizeApproversForNotify(doc) {
  const raw = doc || {}
  const mode = up(raw.approvalMode)

  const needsGM = ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY', 'MANAGER_ONLY'].includes(mode) // MANAGER_ONLY needs GM FYI
  const needsCOO = ['MANAGER_AND_COO', 'GM_AND_COO', 'COO_ONLY', 'GM_ONLY'].includes(mode) // GM_ONLY needs COO FYI

  return {
    ...raw,
    gmLoginId: needsGM ? (s(raw.gmLoginId) || FIXED_GM) : s(raw.gmLoginId),
    cooLoginId: needsCOO ? (s(raw.cooLoginId) || FIXED_COO) : s(raw.cooLoginId),
  }
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
      module: 'FORGET_SCAN',
      event,
      doc,
      actorLabel,
      silent,
    })
  } catch (err) {
    console.warn('[forgetscan.notify] admin watcher failed:', err?.response?.data || err?.message)
  }
}

/* ───────── Employee submit confirmation + leave admin watcher ───────── */
async function notifyForgetCreatedToEmployee(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveEmployeeChatId(d)
    if (chatId) {
      await sendForgetScanDM(chatId, msg.employeeSubmitted(d))
    } else {
      log('skip employee submitted (no chatId)', d.employeeId)
    }

    await notifyAdminWatcher('SUBMITTED', d, d?.requesterLoginId || 'Employee', false)
  } catch (err) {
    console.error('[forgetscan.notify] notifyForgetCreatedToEmployee error:', err.message)
  }
}

/* ───────── Approver inbox DMs (action required) ───────── */
async function notifyToManager(doc, opts = {}) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveManagerChatId(d)
    if (!chatId) return log('skip manager (no chatId)', d.managerLoginId)

    const employeeName = (await getEmployeeName(d.employeeId)) || d.employeeName || d.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(d, employeeName, 'Manager'), opts)
  } catch (err) {
    console.error('[forgetscan.notify] notifyToManager error:', err.message)
  }
}

async function notifyToGm(doc, opts = {}) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveGmChatId(d)
    if (!chatId) return log('skip gm (no chatId)', d.gmLoginId)

    const employeeName = (await getEmployeeName(d.employeeId)) || d.employeeName || d.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(d, employeeName, 'GM'), opts)
  } catch (err) {
    console.error('[forgetscan.notify] notifyToGm error:', err.message)
  }
}

async function notifyToCoo(doc, opts = {}) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveCooChatId(d)
    if (!chatId) return log('skip coo (no chatId)', d.cooLoginId)

    const employeeName = (await getEmployeeName(d.employeeId)) || d.employeeName || d.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(d, employeeName, 'COO'), opts)
  } catch (err) {
    console.error('[forgetscan.notify] notifyToCoo error:', err.message)
  }
}

/* ───────── FYI / Read-only DMs (NO ACTION) ───────── */
async function notifyGmFYI(doc, waitingForLabel) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveGmChatId(d)
    if (!chatId) return log('skip gm FYI (no chatId)', d.gmLoginId)

    const employeeName = (await getEmployeeName(d.employeeId)) || d.employeeName || d.employeeId
    await sendForgetScanDM(chatId, msg.fyiNew(d, employeeName, 'GM', waitingForLabel), { disable_notification: true })
  } catch (err) {
    console.error('[forgetscan.notify] notifyGmFYI error:', err.message)
  }
}

async function notifyCooFYI(doc, waitingForLabel) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveCooChatId(d)
    if (!chatId) return log('skip coo FYI (no chatId)', d.cooLoginId)

    const employeeName = (await getEmployeeName(d.employeeId)) || d.employeeName || d.employeeId
    await sendForgetScanDM(chatId, msg.fyiNew(d, employeeName, 'COO', waitingForLabel), { disable_notification: true })
  } catch (err) {
    console.error('[forgetscan.notify] notifyCooFYI error:', err.message)
  }
}

/**
 * ✅ Current approver (based on doc.status) + FYI rules
 * - MANAGER_ONLY: action → manager, FYI → GM silently
 * - GM_ONLY     : action → GM, FYI → COO silently
 * - others      : notify only current approver (no FYI)
 */
async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const st = up(d.status)
    const mode = up(d.approvalMode)

    // ✅ guard final statuses
    if (st === 'APPROVED' || st === 'REJECTED' || st === 'CANCELLED') return

    // ✅ MANAGER_ONLY: manager action + GM FYI
    if (mode === 'MANAGER_ONLY' && st === 'PENDING_MANAGER') {
      await notifyToManager(d)
      await notifyGmFYI(d, 'Manager')
      return
    }

    // ✅ GM_ONLY: GM action + COO FYI
    if (mode === 'GM_ONLY' && st === 'PENDING_GM') {
      await notifyToGm(d)
      await notifyCooFYI(d, 'GM')
      return
    }

    // default action required (no FYI)
    if (st === 'PENDING_MANAGER') return await notifyToManager(d)
    if (st === 'PENDING_GM') return await notifyToGm(d)
    if (st === 'PENDING_COO') return await notifyToCoo(d)
  } catch (err) {
    console.error('[forgetscan.notify] notifyCurrentApprover error:', err.message)
  }
}

/* ───────── Decision → employee + leave admin watcher ───────── */
async function notifyManagerDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveEmployeeChatId(d)
    if (chatId) {
      await sendForgetScanDM(chatId, msg.employeeDecision(d, 'Manager'))
    }

    const adminEvent = adminEventForDecision(d)
    await notifyAdminWatcher(adminEvent.event, d, 'Manager', adminEvent.silent)
  } catch (err) {
    console.error('[forgetscan.notify] notifyManagerDecisionToEmployee error:', err.message)
  }
}

async function notifyGmDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveEmployeeChatId(d)
    if (chatId) {
      const st = up(d.status)

      // ✅ GM approved but still needs COO (final) approval
      if (st === 'PENDING_COO') {
        await sendForgetScanDM(chatId, msg.employeeWaitingNextApprover(d, 'GM', 'COO'))
      } else {
        await sendForgetScanDM(chatId, msg.employeeDecision(d, 'GM'))
      }
    }

    const adminEvent = adminEventForDecision(d)
    await notifyAdminWatcher(adminEvent.event, d, 'GM', adminEvent.silent)
  } catch (err) {
    console.error('[forgetscan.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

async function notifyCooDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveEmployeeChatId(d)
    if (chatId) {
      await sendForgetScanDM(chatId, msg.employeeDecision(d, 'COO'))
    }

    const adminEvent = adminEventForDecision(d)
    await notifyAdminWatcher(adminEvent.event, d, 'COO', adminEvent.silent)
  } catch (err) {
    console.error('[forgetscan.notify] notifyCooDecisionToEmployee error:', err.message)
  }
}

/* ───────── Cancel notice → employee + leave admin watcher ───────── */
async function notifyCancelledToEmployee(doc) {
  try {
    if (!doc) return
    const d = normalizeApproversForNotify(doc)

    const chatId = await rec.resolveEmployeeChatId(d)
    const pseudo = { ...d, status: 'CANCELLED' }
    if (chatId) {
      await sendForgetScanDM(chatId, msg.employeeDecision(pseudo, 'System'))
    }

    await notifyAdminWatcher('CANCELLED', pseudo, d?.cancelledBy || 'System', false)
  } catch (err) {
    console.error('[forgetscan.notify] notifyCancelledToEmployee error:', err.message)
  }
}

module.exports = {
  notifyForgetCreatedToEmployee,
  notifyCurrentApprover,

  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  notifyCancelledToEmployee,
}
