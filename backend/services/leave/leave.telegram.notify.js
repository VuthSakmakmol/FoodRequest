// backend/services/leave/leave.telegram.notify.js
/* eslint-disable no-console */
const User = require('../../models/User')
const { sendLeaveDM } = require('./leave.telegram.service')
const msg = require('./leave.telegram.messages')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
function log(...args) { if (DEBUG) console.log('[leave.notify]', ...args) }

async function findUser(loginId) {
  const clean = String(loginId || '').trim()
  if (!clean) return null
  return User.findOne({ loginId: clean }).lean()
}

/** ✅ ONLY LEAVE_ADMIN (DO NOT INCLUDE ADMIN) */
async function findLeaveAdmins() {
  return User.find({ role: 'LEAVE_ADMIN', isActive: true }).lean()
}

async function dmMany(users, text, label = '') {
  const list = Array.isArray(users) ? users : []
  for (const u of list) {
    const chatId = u?.telegramChatId
    if (!chatId) {
      log(`skip ${label} (no chatId)`, u?.loginId)
      continue
    }
    await sendLeaveDM(chatId, text)
  }
}

/* ─────────────────────────────
 * Employee submit success → DM Employee
 * ───────────────────────────── */
async function notifyEmployeeSubmitted(doc) {
  try {
    if (!doc) return
    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId
    if (!chatId) return log('skip employee submitted (no chatId)', employeeLoginId)

    await sendLeaveDM(chatId, msg.employeeSubmitted(doc))
  } catch (err) {
    console.error('[leave.notify] notifyEmployeeSubmitted error:', err.message)
  }
}

/* ─────────────────────────────
 * New request → DM Manager
 * ───────────────────────────── */
async function notifyNewLeaveToManager(doc) {
  try {
    if (!doc) return
    const managerLoginId = String(doc.managerLoginId || '').trim()
    if (!managerLoginId) return

    const [mgrUser, empUser] = await Promise.all([
      findUser(managerLoginId),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])

    const chatId = mgrUser?.telegramChatId
    if (!chatId) return log('skip manager new request (no chatId)', managerLoginId)

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await sendLeaveDM(chatId, msg.managerNewRequest(doc, employeeName))
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToManager error:', err.message)
  }
}

/* ─────────────────────────────
 * Forwarded / pending final → DM GM
 * ───────────────────────────── */
async function notifyNewLeaveToGm(doc) {
  try {
    if (!doc) return
    const gmLoginId = String(doc.gmLoginId || '').trim()
    if (!gmLoginId) return

    const [gmUser, empUser] = await Promise.all([
      findUser(gmLoginId),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])

    const chatId = gmUser?.telegramChatId
    if (!chatId) return log('skip gm new request (no chatId)', gmLoginId)

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await sendLeaveDM(chatId, msg.gmNewRequest(doc, employeeName))
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToGm error:', err.message)
  }
}

/* ─────────────────────────────
 * ✅ NEW: DM COO when approvalMode = GM_AND_COO
 * ───────────────────────────── */
async function notifyNewLeaveToCoo(doc) {
  try {
    if (!doc) return
    const mode = String(doc.approvalMode || 'GM_ONLY').toUpperCase()
    if (mode !== 'GM_AND_COO') return

    const cooLoginId = String(doc.cooLoginId || '').trim()
    if (!cooLoginId) return

    const [cooUser, empUser] = await Promise.all([
      findUser(cooLoginId),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])

    const chatId = cooUser?.telegramChatId
    if (!chatId) return log('skip coo new request (no chatId)', cooLoginId)

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await sendLeaveDM(chatId, msg.cooNewRequest(doc, employeeName))
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToCoo error:', err.message)
  }
}

/* ─────────────────────────────
 * Manager decision → DM Employee
 * ───────────────────────────── */
async function notifyManagerDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId
    if (!chatId) return

    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'Manager'))
  } catch (err) {
    console.error('[leave.notify] notifyManagerDecisionToEmployee error:', err.message)
  }
}

/* ─────────────────────────────
 * GM decision → DM Employee
 * ───────────────────────────── */
async function notifyGmDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId
    if (!chatId) return

    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'GM'))
  } catch (err) {
    console.error('[leave.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

/* ─────────────────────────────
 * ✅ NEW: COO decision → DM Employee
 * ───────────────────────────── */
async function notifyCooDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId
    if (!chatId) return

    await sendLeaveDM(chatId, msg.employeeDecision(doc, 'COO'))
  } catch (err) {
    console.error('[leave.notify] notifyCooDecisionToEmployee error:', err.message)
  }
}

/* ─────────────────────────────
 * ✅ LEAVE_ADMIN notifications (ALL activity)
 * ───────────────────────────── */
async function notifyLeaveAdminNewRequest(doc) {
  try {
    if (!doc) return
    const [admins, empUser] = await Promise.all([
      findLeaveAdmins(),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])
    if (!admins?.length) return

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await dmMany(admins, msg.leaveAdminNewRequest(doc, employeeName), 'leave_admin')
  } catch (err) {
    console.error('[leave.notify] notifyLeaveAdminNewRequest error:', err.message)
  }
}

async function notifyLeaveAdminManagerDecision(doc) {
  try {
    if (!doc) return
    const [admins, empUser] = await Promise.all([
      findLeaveAdmins(),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])
    if (!admins?.length) return

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await dmMany(admins, msg.leaveAdminManagerDecision(doc, employeeName), 'leave_admin')
  } catch (err) {
    console.error('[leave.notify] notifyLeaveAdminManagerDecision error:', err.message)
  }
}

async function notifyLeaveAdminGmDecision(doc) {
  try {
    if (!doc) return
    const [admins, empUser] = await Promise.all([
      findLeaveAdmins(),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])
    if (!admins?.length) return

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await dmMany(admins, msg.leaveAdminGmDecision(doc, employeeName), 'leave_admin')
  } catch (err) {
    console.error('[leave.notify] notifyLeaveAdminGmDecision error:', err.message)
  }
}

async function notifyLeaveAdminCooDecision(doc) {
  try {
    if (!doc) return
    const [admins, empUser] = await Promise.all([
      findLeaveAdmins(),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])
    if (!admins?.length) return

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    await dmMany(admins, msg.leaveAdminCooDecision(doc, employeeName), 'leave_admin')
  } catch (err) {
    console.error('[leave.notify] notifyLeaveAdminCooDecision error:', err.message)
  }
}

/* ─────────────────────────────
 * ✅ WRAPPERS (these match your controller imports)
 *    This removes "is not a function" errors.
 * ───────────────────────────── */
async function notifyManagerDecision(doc) {
  await notifyManagerDecisionToEmployee(doc)
  await notifyLeaveAdminManagerDecision(doc)
}

async function notifyGmDecision(doc) {
  await notifyGmDecisionToEmployee(doc)
  await notifyLeaveAdminGmDecision(doc)
}

async function notifyCooDecision(doc) {
  await notifyCooDecisionToEmployee(doc)
  await notifyLeaveAdminCooDecision(doc)
}

module.exports = {
  // employee
  notifyEmployeeSubmitted,

  // manager/gm workflow
  notifyNewLeaveToManager,
  notifyNewLeaveToGm,

  // ✅ COO workflow
  notifyNewLeaveToCoo,

  // decision wrappers (✅ match controller names)
  notifyManagerDecision,
  notifyGmDecision,
  notifyCooDecision,

  // (optional internal)
  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  // leave_admin only
  notifyLeaveAdminNewRequest,
  notifyLeaveAdminManagerDecision,
  notifyLeaveAdminGmDecision,
  notifyLeaveAdminCooDecision,
}
