/* eslint-disable no-console */
// backend/services/telegram/forgetScan/forgetScan.telegram.notify.js

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const msg = require('./forgetScan.telegram.messages')
const rec = require('./forgetScan.telegram.recipients')
const { sendForgetScanDM } = require('./forgetScan.telegram.service')

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

async function getEmployeeName(employeeId) {
  const empId = s(employeeId)
  if (!empId) return ''
  const emp = await EmployeeDirectory.findOne({ employeeId: empId }, { name: 1, fullName: 1 }).lean()
  return emp?.name || emp?.fullName || ''
}

/* ───────── Employee submit confirmation ───────── */
async function notifyForgetCreatedToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return log('skip employee submitted (no chatId)', doc.employeeId)
    await sendForgetScanDM(chatId, msg.employeeSubmitted(doc))
  } catch (err) {
    console.error('[forgetscan.notify] notifyForgetCreatedToEmployee error:', err.message)
  }
}

/* ───────── Approver inbox DMs (action required) ───────── */
async function notifyToManager(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveManagerChatId(doc)
    if (!chatId) return log('skip manager (no chatId)', doc.managerLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(doc, employeeName, 'Manager'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyToManager error:', err.message)
  }
}

async function notifyToGm(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveGmChatId(doc)
    if (!chatId) return log('skip gm (no chatId)', doc.gmLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(doc, employeeName, 'GM'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyToGm error:', err.message)
  }
}

async function notifyToCoo(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveCooChatId(doc)
    if (!chatId) return log('skip coo (no chatId)', doc.cooLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.approverNew(doc, employeeName, 'COO'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyToCoo error:', err.message)
  }
}

/* ───────── FYI / Read-only DMs (NO ACTION) ───────── */
async function notifyGmFYI(doc, waitingForLabel) {
  try {
    if (!doc) return
    const chatId = await rec.resolveGmChatId(doc)
    if (!chatId) return log('skip gm FYI (no chatId)', doc.gmLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.fyiNew(doc, employeeName, 'GM', waitingForLabel))
  } catch (err) {
    console.error('[forgetscan.notify] notifyGmFYI error:', err.message)
  }
}

async function notifyCooFYI(doc, waitingForLabel) {
  try {
    if (!doc) return
    const chatId = await rec.resolveCooChatId(doc)
    if (!chatId) return log('skip coo FYI (no chatId)', doc.cooLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.fyiNew(doc, employeeName, 'COO', waitingForLabel))
  } catch (err) {
    console.error('[forgetscan.notify] notifyCooFYI error:', err.message)
  }
}

/**
 * ✅ Current approver (based on doc.status) + FYI rules
 *
 * Your rule:
 * - even if MANAGER_ONLY, GM is still "involved" as read-only, so GM must receive FYI alert
 *
 * Rules implemented:
 * - MANAGER_ONLY: action → manager, FYI → GM
 * - GM_ONLY     : action → GM, FYI → COO
 * - others      : notify only current approver (no FYI)
 */
async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return

    const st = up(doc.status)
    const mode = up(doc.approvalMode)

    // ✅ MANAGER_ONLY: manager action + GM FYI
    if (mode === 'MANAGER_ONLY' && st === 'PENDING_MANAGER') {
      await notifyToManager(doc)
      await notifyGmFYI(doc, 'Manager')
      return
    }

    // ✅ GM_ONLY: GM action + COO FYI
    if (mode === 'GM_ONLY' && st === 'PENDING_GM') {
      await notifyToGm(doc)
      await notifyCooFYI(doc, 'GM')
      return
    }

    // default action required (no FYI)
    if (st === 'PENDING_MANAGER') return await notifyToManager(doc)
    if (st === 'PENDING_GM') return await notifyToGm(doc)
    if (st === 'PENDING_COO') return await notifyToCoo(doc)
  } catch (err) {
    console.error('[forgetscan.notify] notifyCurrentApprover error:', err.message)
  }
}

/* ───────── Decision → employee ───────── */
async function notifyManagerDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendForgetScanDM(chatId, msg.employeeDecision(doc, 'Manager'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyManagerDecisionToEmployee error:', err.message)
  }
}

async function notifyGmDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return

    const st = up(doc.status)

    // ✅ GM approved but still needs COO (final) approval
    if (st === 'PENDING_COO') {
      await sendForgetScanDM(chatId, msg.employeeWaitingNextApprover(doc, 'GM', 'COO'))
      return
    }

    // ✅ Final result (APPROVED / REJECTED / CANCELLED)
    await sendForgetScanDM(chatId, msg.employeeDecision(doc, 'GM'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

async function notifyCooDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendForgetScanDM(chatId, msg.employeeDecision(doc, 'COO'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyCooDecisionToEmployee error:', err.message)
  }
}

/* ───────── Cancel notice → employee ───────── */
async function notifyCancelledToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    const pseudo = { ...doc, status: 'CANCELLED' }
    await sendForgetScanDM(chatId, msg.employeeDecision(pseudo, 'System'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyCancelledToEmployee error:', err.message)
  }
}

module.exports = {
  // create flow
  notifyForgetCreatedToEmployee,
  notifyCurrentApprover,

  // decision flow
  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  // optional cancel
  notifyCancelledToEmployee,
}