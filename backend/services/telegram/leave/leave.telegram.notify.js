/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.notify.js

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

async function dmAdmins(doc, text) {
  const chatIds = await rec.resolveAdminChatIds(doc?._id)
  if (!chatIds.length) return log('skip admins (no chatIds)')
  for (const cid of chatIds) {
    try {
      await sendLeaveDM(cid, text)
    } catch (e) {
      console.warn('[leave.notify] admin DM failed', e?.message)
    }
  }
}

/* Create: employee confirm */
async function notifyCreatedToEmployee(doc) {
  const chatId = await rec.resolveEmployeeChatId(doc)
  if (!chatId) return
  await sendLeaveDM(chatId, msg.employeeSubmitted(doc))
}

/* Admin: create/update */
async function notifyAdminsOnCreate(doc) {
  const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
  await dmAdmins(doc, msg.adminCreated(doc, employeeName))
}
async function notifyAdminsOnUpdate(doc) {
  const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
  await dmAdmins(doc, msg.adminUpdated(doc, employeeName))
}

/* Current approver: based on status */
async function notifyCurrentApprover(doc) {
  const st = up(doc?.status)
  const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId

  if (st === 'PENDING_MANAGER') {
    const chatId = await rec.resolveManagerChatId(doc)
    if (!chatId) return
    return sendLeaveDM(chatId, msg.managerNew(doc, employeeName))
  }
  if (st === 'PENDING_GM') {
    const chatId = await rec.resolveGmChatId(doc)
    if (!chatId) return
    return sendLeaveDM(chatId, msg.gmNew(doc, employeeName))
  }
  if (st === 'PENDING_COO') {
    const chatId = await rec.resolveCooChatId(doc)
    if (!chatId) return
    return sendLeaveDM(chatId, msg.cooNew(doc, employeeName))
  }
}

/* Decisions: employee + admins + next approver handled by controller calling notifyCurrentApprover */
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
  notifyAdminsOnCreate,
  notifyAdminsOnUpdate,
  notifyCurrentApprover,

  notifyManagerDecisionToEmployee,
  notifyGmDecisionToEmployee,
  notifyCooDecisionToEmployee,

  notifyCancelledToEmployee,
}