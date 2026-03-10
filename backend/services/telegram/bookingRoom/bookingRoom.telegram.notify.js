/* backend/services/telegram/bookingRoom/bookingRoom.telegram.notify*/
/* eslint-disable no-console */
const msg = require('./bookingRoom.telegram.messages')
const rec = require('./bookingRoom.telegram.recipients')
const { sendBookingRoomDM } = require('./bookingRoom.telegram.service')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function log(...args) {
  if (DEBUG) console.log('[bookingRoom.notify]', ...args)
}

function up(v) {
  return String(v ?? '').trim().toUpperCase()
}

async function sendToMany(users = [], text = '') {
  for (const u of users || []) {
    if (!u?.chatId) continue
    try {
      await sendBookingRoomDM(u.chatId, text)
    } catch (e) {
      console.error('[bookingRoom.notify] sendToMany error:', e.message)
    }
  }
}

/* ─────────────────────────────
 * Employee submit/update/cancel
 * ───────────────────────────── */
async function notifyBookingCreatedToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return log('skip employee submitted (no chatId)', doc.employeeId)
    await sendBookingRoomDM(chatId, msg.employeeSubmitted(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyBookingCreatedToEmployee error:', err.message)
  }
}

async function notifyBookingUpdatedToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return log('skip employee updated (no chatId)', doc.employeeId)
    await sendBookingRoomDM(chatId, msg.employeeUpdated(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyBookingUpdatedToEmployee error:', err.message)
  }
}

async function notifyBookingCancelledToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return log('skip employee cancelled (no chatId)', doc.employeeId)
    await sendBookingRoomDM(chatId, msg.employeeCancelled(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyBookingCancelledToEmployee error:', err.message)
  }
}

/* ─────────────────────────────
 * Approver queue DMs
 * ───────────────────────────── */
async function notifyBookingToRoomAdmins(doc) {
  try {
    if (!doc?.roomRequired) return
    if (up(doc?.overallStatus) === 'CANCELLED') return
    if (up(doc?.roomStatus) !== 'PENDING') return

    const users = await rec.resolveRoomAdminRecipients(doc)
    if (!users.length) return log('skip room admins (no recipients)', doc?._id)

    await sendToMany(users, msg.roomAdminNewBooking(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyBookingToRoomAdmins error:', err.message)
  }
}

async function notifyBookingToMaterialAdmins(doc) {
  try {
    if (!doc?.materialRequired) return
    if (up(doc?.overallStatus) === 'CANCELLED') return
    if (up(doc?.materialStatus) !== 'PENDING') return

    const users = await rec.resolveMaterialAdminRecipients(doc)
    if (!users.length) return log('skip material admins (no recipients)', doc?._id)

    await sendToMany(users, msg.materialAdminNewBooking(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyBookingToMaterialAdmins error:', err.message)
  }
}

async function notifyCurrentApprover(doc) {
  try {
    if (!doc) return
    if (up(doc?.overallStatus) === 'CANCELLED') return
    if (up(doc?.overallStatus) === 'APPROVED') return
    if (up(doc?.overallStatus) === 'REJECTED') return

    if (doc?.roomRequired && up(doc?.roomStatus) === 'PENDING') {
      await notifyBookingToRoomAdmins(doc)
    }

    if (doc?.materialRequired && up(doc?.materialStatus) === 'PENDING') {
      await notifyBookingToMaterialAdmins(doc)
    }
  } catch (err) {
    console.error('[bookingRoom.notify] notifyCurrentApprover error:', err.message)
  }
}

/* ─────────────────────────────
 * Decision → Employee
 * ───────────────────────────── */
async function notifyRoomDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendBookingRoomDM(chatId, msg.employeeRoomDecision(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyRoomDecisionToEmployee error:', err.message)
  }
}

async function notifyMaterialDecisionToEmployee(doc) {
  try {
    if (!doc) return
    const chatId = await rec.resolveEmployeeChatId(doc)
    if (!chatId) return
    await sendBookingRoomDM(chatId, msg.employeeMaterialDecision(doc))
  } catch (err) {
    console.error('[bookingRoom.notify] notifyMaterialDecisionToEmployee error:', err.message)
  }
}

module.exports = {
  notifyBookingCreatedToEmployee,
  notifyBookingUpdatedToEmployee,
  notifyBookingCancelledToEmployee,

  notifyBookingToRoomAdmins,
  notifyBookingToMaterialAdmins,
  notifyCurrentApprover,

  notifyRoomDecisionToEmployee,
  notifyMaterialDecisionToEmployee,
}