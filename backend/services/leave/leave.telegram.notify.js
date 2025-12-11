// backend/services/leave/leave.telegram.notify.js
/* eslint-disable no-console */
const User = require('../../models/User')
const { sendDM } = require('../transport.telegram.service')  // ✅ reuse working DM
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

    const employeeName =
      empUser?.name || doc.employeeId || doc.requesterLoginId

    const text = msg.managerNewRequest(doc, employeeName)

    log('DM → Manager', { chatId, managerLoginId })
    await sendDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToManager error:', err.message)
  }
}

/* ─────────────────────────────
 * Request forwarded to GM (PENDING_GM) → DM GM
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

    const employeeName =
      empUser?.name || doc.employeeId || doc.requesterLoginId

    const text = msg.gmNewRequest(doc, employeeName)

    log('DM → GM', { chatId, gmLoginId })
    await sendDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyNewLeaveToGm error:', err.message)
  }
}

/* ─────────────────────────────
 * Manager decision → DM Employee
 * ───────────────────────────── */
async function notifyManagerDecision(doc) {
  try {
    if (!doc) return

    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId

    if (!chatId) {
      log('Employee has no telegramChatId; skip notifyManagerDecision', employeeLoginId)
      return
    }

    const text = msg.employeeDecision(doc, 'Manager')

    log('DM → Employee (manager decision)', { chatId, employeeLoginId })
    await sendDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyManagerDecision error:', err.message)
  }
}

/* ─────────────────────────────
 * GM final decision → DM Employee
 * ───────────────────────────── */
async function notifyGmDecision(doc) {
  try {
    if (!doc) return

    const employeeLoginId = doc.employeeId || doc.requesterLoginId
    const empUser = await findUser(employeeLoginId)
    const chatId = empUser?.telegramChatId

    if (!chatId) {
      log('Employee has no telegramChatId; skip notifyGmDecision', employeeLoginId)
      return
    }

    const text = msg.employeeDecision(doc, 'GM')

    log('DM → Employee (GM decision)', { chatId, employeeLoginId })
    await sendDM(chatId, text)
  } catch (err) {
    console.error('[leave.notify] notifyGmDecision error:', err.message)
  }
}

module.exports = {
  notifyNewLeaveToManager,
  notifyNewLeaveToGm,
  notifyManagerDecision,
  notifyGmDecision,
}
