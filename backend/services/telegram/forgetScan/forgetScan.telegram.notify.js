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

/* ───────── Approver inbox DMs ───────── */
async function notifyToManager(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveManagerChatId(doc)
    if (!chatId) return log('skip manager (no chatId)', doc.managerLoginId)

    const employeeName = (await getEmployeeName(doc.employeeId)) || doc.employeeName || doc.employeeId
    await sendForgetScanDM(chatId, msg.managerNew(doc, employeeName))
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
    await sendForgetScanDM(chatId, msg.gmNew(doc, employeeName))
  } catch (err) {
    console.error('[forgetscan.notify] notifyToGm error:', err.message)
  }
}

/* ───────── Current approver ───────── */
async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return
    const st = up(doc.status)
    if (st === 'PENDING_MANAGER') return await notifyToManager(doc)
    if (st === 'PENDING_GM') return await notifyToGm(doc)
    // ✅ ignore PENDING_COO (should not happen in special flow)
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
    await sendForgetScanDM(chatId, msg.employeeDecision(doc, 'GM'))
  } catch (err) {
    console.error('[forgetscan.notify] notifyGmDecisionToEmployee error:', err.message)
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

  // optional cancel
  notifyCancelledToEmployee,
}