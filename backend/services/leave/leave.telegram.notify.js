// backend/services/leave/leave.telegram.notify.js
/* eslint-disable no-console */
const User = require('../../models/User')
const { sendLeaveDM } = require('./leave.telegram.service')
const msg = require('./leave.telegram.messages')

const DEBUG =
  String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function log(...args) {
  if (DEBUG) console.log('[leave.notify]', ...args)
}

async function findUser(loginId) {
  if (!loginId) return null
  const clean = String(loginId).trim()
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

    if (!chatId) {
      log('Employee has no telegramChatId; skip notifyEmployeeSubmitted', employeeLoginId)
      return
    }

    const text = msg.employeeSubmitted(doc)
    log('DM → Employee (submitted)', { employeeLoginId, chatId })
    await sendLeaveDM(chatId, text)
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

    const managerLoginId = doc.managerLoginId
    if (!managerLoginId) {
      log('No managerLoginId on doc; skip notifyNewLeaveToManager')
      return
    }

    const [mgrUser, empUser] = await Promise.all([
      findUser(managerLoginId),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])

    const chatId = mgrUser?.telegramChatId
    if (!chatId) {
      log('Manager has no telegramChatId; skip', managerLoginId)
      return
    }

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    const text = msg.managerNewRequest(doc, employeeName)

    log('DM → Manager', { managerLoginId, chatId })
    await sendLeaveDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToManager error:', err.message)
  }
}

/* ─────────────────────────────
 * Request forwarded to GM → DM GM
 * ───────────────────────────── */
async function notifyNewLeaveToGm(doc) {
  try {
    if (!doc) return

    const gmLoginId = doc.gmLoginId
    if (!gmLoginId) {
      log('No gmLoginId on doc; skip notifyNewLeaveToGm')
      return
    }

    const [gmUser, empUser] = await Promise.all([
      findUser(gmLoginId),
      findUser(doc.employeeId || doc.requesterLoginId),
    ])

    const chatId = gmUser?.telegramChatId
    if (!chatId) {
      log('GM has no telegramChatId; skip', gmLoginId)
      return
    }

    const employeeName = empUser?.name || doc.employeeId || doc.requesterLoginId
    const text = msg.gmNewRequest(doc, employeeName)

    log('DM → GM', { gmLoginId, chatId })
    await sendLeaveDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToGm error:', err.message)
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

    if (!chatId) {
      log('Employee has no telegramChatId; skip notifyManagerDecisionToEmployee', employeeLoginId)
      return
    }

    const text = msg.employeeDecision(doc, 'Manager')

    log('DM → Employee (manager decision)', { employeeLoginId, chatId })
    await sendLeaveDM(chatId, text)
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

    if (!chatId) {
      log('Employee has no telegramChatId; skip notifyGmDecisionToEmployee', employeeLoginId)
      return
    }

    const text = msg.employeeDecision(doc, 'GM')

    log('DM → Employee (gm decision)', { employeeLoginId, chatId })
    await sendLeaveDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyGmDecisionToEmployee error:', err.message)
  }
}

/* ─────────────────────────────
 * ✅ LEAVE_ADMIN notifications (ALL activity)
 *    ❌ DO NOT notify ADMIN role
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
    const text = msg.leaveAdminNewRequest(doc, employeeName)

    log('DM → LEAVE_ADMIN (new request)', { count: admins.length })
    await dmMany(admins, text, 'leave_admin')
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
    const text = msg.leaveAdminManagerDecision(doc, employeeName)

    log('DM → LEAVE_ADMIN (manager decision)', { count: admins.length })
    await dmMany(admins, text, 'leave_admin')
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
    const text = msg.leaveAdminGmDecision(doc, employeeName)

    log('DM → LEAVE_ADMIN (gm decision)', { count: admins.length })
    await dmMany(admins, text, 'leave_admin')
  } catch (err) {
    console.error('[leave.notify] notifyLeaveAdminGmDecision error:', err.message)
  }
}

module.exports = {
  // employee
  notifyEmployeeSubmitted,

  // manager/gm workflow
  notifyNewLeaveToManager,
  notifyNewLeaveToGm,
  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,

  // ✅ leave_admin only (NOT ADMIN)
  notifyLeaveAdminNewRequest,
  notifyLeaveAdminManagerDecision,
  notifyLeaveAdminGmDecision,
}
