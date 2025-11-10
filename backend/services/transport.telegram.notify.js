// backend/services/transport.telegram.notify.js
/* eslint-disable no-console */
const CarBooking = require('../models/transportation/CarBooking')
const { sendToTransportGroup, sendDM } = require('./transport.telegram.service')
const { resolveAssignedDriverChatId, resolveEmployeeChatId } = require('./transport.telegram.recipients')
const msg = require('./transport.telegram.messages')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const ENABLE_EMP_DM = String(process.env.TELEGRAM_ENABLE_EMPLOYEE_DM || 'true').toLowerCase() === 'true'

async function notify(event, payload) {
  if (DEBUG) console.log('[notify]', event, payload)

  // Helper: safely fetch booking
  const getBk = async () => {
    const bk = await CarBooking.findById(payload.bookingId).lean()
    if (!bk) console.warn('[notify] booking not found', { event, bookingId: String(payload.bookingId || '') })
    return bk
  }

  switch (event) {
    // ───────────────────────────────
    case 'REQUEST_CREATED': {
      const bk = await getBk(); if (!bk) return

      // Group alert (unchanged)
      await sendToTransportGroup(msg.newRequestMsg(bk))

      // DM employee (new)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (DEBUG) console.log('[notify] resolved employee chatId', { empChat })
        if (empChat) await sendDM(empChat, msg.employeeRequestDM(bk))
      }
      return
    }

    // ───────────────────────────────
    case 'ADMIN_DECLINED': {
      const bk = await getBk(); if (!bk) return

      // Group alert (unchanged)
      await sendToTransportGroup(msg.declinedMsg(bk, payload.reason, payload.byName))

      // DM employee (new)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeDeclinedDM(bk, payload.reason, payload.byName))
      }
      return
    }

    // ───────────────────────────────
    case 'ADMIN_ACCEPTED_ASSIGNED': {
      const bk = await getBk(); if (!bk) return

      // Group alert
      await sendToTransportGroup(msg.acceptedAssignedMsg(bk))

      // DM driver
      const drvChat = await resolveAssignedDriverChatId(bk)
      if (drvChat) await sendDM(drvChat, msg.driverAssignmentDM(bk))

      // DM employee (new)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeAcceptedDM(bk))
      }
      return
    }

    // ───────────────────────────────
    case 'STATUS_CHANGED': {
      const bk = await getBk(); if (!bk) return

      // Group alert
      await sendToTransportGroup(msg.statusChangedMsg(bk, payload.newStatus, payload.byName))

      // DM driver
      const drvChat = await resolveAssignedDriverChatId(bk)
      if (drvChat) await sendDM(drvChat, msg.driverStatusDM(bk, payload.newStatus))

      // DM employee (new)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeStatusDM(bk, payload.newStatus))
      }
      return
    }

    // ───────────────────────────────
    case 'DRIVER_ACK': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return
      const resp = String(payload.response || bk?.assignment?.driverAck || '').toUpperCase()

      // Group alert
      await sendToTransportGroup(msg.driverAckGroupMsg(bk, resp))

      // DM driver
      const drvChat = await resolveAssignedDriverChatId(bk)
      if (drvChat) await sendDM(drvChat, msg.driverAckConfirmDM(bk, resp))

      // DM employee (optional, to inform status)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeDriverAckDM(bk, resp))
      }
      return
    }
  }
}

module.exports = { notify }
