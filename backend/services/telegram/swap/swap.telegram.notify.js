/* eslint-disable no-console */
// backend/services/telegram/swap/swap.telegram.notify.js

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const msg = require('./swap.telegram.messages')
const rec = require('./swap.telegram.recipients')
const { sendSwapDM } = require('./swap.telegram.service')

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

/* ─────────────────────────────
 * Employee submit confirmation
 * ───────────────────────────── */
async function notifySwapRequestCreated(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return log('skip employee submitted (no chatId)', doc.employeeId)
    await sendSwapDM(chatId, msg.employeeSubmitted(doc))
  } catch (err) {
    console.error('[swap.notify] notifySwapRequestCreated error:', err.message)
  }
}

/* ─────────────────────────────
 * Approver inbox DMs
 * ───────────────────────────── */
async function notifySwapToManager(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveManagerChatId(doc)
    if (!chatId) return log('skip manager (no chatId)', doc.managerLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.managerNewSwap(doc, employeeName))
  } catch (err) {
    console.error('[swap.notify] notifySwapToManager error:', err.message)
  }
}

async function notifySwapToGm(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveGmChatId(doc)
    if (!chatId) return log('skip gm (no chatId)', doc.gmLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.gmNewSwap(doc, employeeName))
  } catch (err) {
    console.error('[swap.notify] notifySwapToGm error:', err.message)
  }
}

async function notifySwapToCoo(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveCooChatId(doc)
    if (!chatId) return log('skip coo (no chatId)', doc.cooLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendSwapDM(chatId, msg.cooNewSwap(doc, employeeName))
  } catch (err) {
    console.error('[swap.notify] notifySwapToCoo error:', err.message)
  }
}

/**
 * Notify current approver based on STATUS (queue-style)
 *
 * ✅ AND add FYI read-only logic:
 * - PENDING_MANAGER + MANAGER_ONLY => send GM FYI
 * - PENDING_GM + GM_ONLY          => send COO FYI
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
      await notifySwapToGm(doc) // gmNewSwap() will render FYI wording
    }

    // GM_ONLY -> COO gets FYI while GM is final approver
    if (st === 'PENDING_GM' && mode === 'GM_ONLY') {
      await notifySwapToCoo(doc) // cooNewSwap() will render FYI wording
    }
  } catch (err) {
    console.error('[swap.notify] notifyCurrentApprover error:', err.message)
  }
}

/* ─────────────────────────────
 * Decision → Employee
 * ───────────────────────────── */
async function notifyManagerDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendSwapDM(chatId, msg.employeeDecision(doc, 'Manager'))
  } catch (err) {
    console.error('[swap.notify] notifyManagerDecisionToEmployee error:', err.message)
  }
}

async function notifyGmDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendSwapDM(chatId, msg.employeeDecision(doc, 'GM'))
  } catch (err) {
    console.error('[swap.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

async function notifyCooDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendSwapDM(chatId, msg.employeeDecision(doc, 'COO'))
  } catch (err) {
    console.error('[swap.notify] notifyCooDecisionToEmployee error:', err.message)
  }
}

/* Cancel notice (optional) */
async function notifySwapCancelledToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    const pseudo = { ...doc, status: 'CANCELLED' }
    await sendSwapDM(chatId, msg.employeeDecision(pseudo, 'System'))
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