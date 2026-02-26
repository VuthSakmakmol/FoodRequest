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

/* send to many admin chatIds */
async function dmAdmins(doc, text) {
  const chatIds = await rec.resolveAdminChatIds(doc?._id)
  if (!chatIds.length) return log('skip admins (no chatIds)')

  for (const cid of chatIds) {
    try {
      await sendSwapDM(cid, text)
    } catch (e) {
      console.warn('[swap.notify] admin DM failed', e?.message)
    }
  }
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
 * Admin alert (create/update)
 * ───────────────────────────── */
async function notifyAdminsOnCreate(doc) {
  try {
    if (!doc) return
    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    const text = [
      '📣 <b>Swap request created</b>',
      `👤 Employee: <b>${s(employeeName) || '-'}</b>`,
      `📌 Status: <b>${s(doc.status) || '-'}</b>`,
    ].join('\n')

    await dmAdmins(doc, text)
  } catch (err) {
    console.error('[swap.notify] notifyAdminsOnCreate error:', err.message)
  }
}

async function notifyAdminsOnUpdate(doc) {
  try {
    if (!doc) return
    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    const text = [
      '📣 <b>Swap request updated</b>',
      `👤 Employee: <b>${s(employeeName) || '-'}</b>`,
      `📌 Status: <b>${s(doc.status) || '-'}</b>`,
    ].join('\n')

    await dmAdmins(doc, text)
  } catch (err) {
    console.error('[swap.notify] notifyAdminsOnUpdate error:', err.message)
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
 * ✅ Works automatically with new modes:
 * - MANAGER_ONLY -> status PENDING_MANAGER only
 * - GM_ONLY      -> status PENDING_GM only
 *
 * So this function needs only status to route.
 */
async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return
    const st = up(doc.status)

    // ✅ explicit final guards (clean + safe)
    if (st === 'APPROVED' || st === 'REJECTED' || st === 'CANCELLED') return

    if (st === 'PENDING_MANAGER') return await notifySwapToManager(doc)
    if (st === 'PENDING_GM') return await notifySwapToGm(doc)
    if (st === 'PENDING_COO') return await notifySwapToCoo(doc)

    // unknown status => do nothing
    if (DEBUG) log('skip notifyCurrentApprover (unknown status)', st, doc?._id)
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

  // admin alerts
  notifyAdminsOnCreate,
  notifyAdminsOnUpdate,

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