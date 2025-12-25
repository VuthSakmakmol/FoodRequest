// backend/services/transport.telegram.notify.js
/* eslint-disable no-console */
const CarBooking = require('../models/transportation/CarBooking')
const { sendToTransportGroup, sendDM } = require('./transport.telegram.service')
const {
  resolveAssignedDriverChatId,
  resolveAssignedAssigneeChatIds,
  resolveEmployeeChatId,
} = require('./transport.telegram.recipients')
const msg = require('./transport.telegram.messages')

/**
 * HARD-CODED TOGGLES (no .env required)
 * - Driver/Messenger gets ONLY 1 DM when assigned
 * - No status-update DM to driver
 * - No ack-confirm DM to driver
 * - Employee DM can stay enabled (you can turn off if you want)
 */
const DEBUG = false
const ENABLE_EMP_DM = true

const ENABLE_DRIVER_ASSIGN_DM = true
const ENABLE_DRIVER_STATUS_DM = false
const ENABLE_DRIVER_ACK_DM = false

async function notify(event, payload) {
  if (DEBUG) console.log('[notify]', event, payload)

  // Helper: safely fetch booking
  const getBk = async () => {
    const bk = await CarBooking.findById(payload.bookingId).lean()
    if (!bk) {
      console.warn('[notify] booking not found', {
        event,
        bookingId: String(payload.bookingId || ''),
      })
    }
    return bk
  }

  switch (event) {
    // ───────────────────────────────
    // 🚗 NEW REQUEST CREATED
    // ───────────────────────────────
    case 'REQUEST_CREATED': {
      const bk = await getBk()
      if (!bk) return

      // Group alert
      await sendToTransportGroup(msg.newRequestMsg(bk))

      // DM employee
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (DEBUG) console.log('[notify] resolved employee chatId', { empChat })
        if (empChat) await sendDM(empChat, msg.employeeRequestDM(bk))
      }
      return
    }

    // ───────────────────────────────
    // ❌ ADMIN DECLINED
    // ───────────────────────────────
    case 'ADMIN_DECLINED': {
      const bk = await getBk()
      if (!bk) return

      // Group alert
      await sendToTransportGroup(
        msg.declinedMsg(bk, payload.reason, payload.byName)
      )

      // DM employee
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) {
          await sendDM(
            empChat,
            msg.employeeDeclinedDM(bk, payload.reason, payload.byName)
          )
        }
      }
      return
    }

    // ───────────────────────────────
    // ✅ ADMIN ACCEPTED + ASSIGNED
    // ───────────────────────────────
    case 'ADMIN_ACCEPTED_ASSIGNED': {
      const bk = await getBk()
      if (!bk) return

      await sendToTransportGroup(msg.acceptedAssignedMsg(bk))

      if (ENABLE_DRIVER_ASSIGN_DM) {
        const assigneeChats = await resolveAssignedAssigneeChatIds(bk)

        if (!assigneeChats.length) {
          console.warn('[notify] no assigneeChats resolved', {
            bookingId: String(bk._id),
            driverId: bk.assignment?.driverId,
            messengerId: bk.assignment?.messengerId,
          })
        }

        for (const chatId of assigneeChats) {
          await sendDM(chatId, msg.driverAssignmentDM(bk))
        }
      }

      // employee DM stays
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeAcceptedDM(bk))
      }
      return
    }


    // ───────────────────────────────
    // 🔄 STATUS CHANGED
    // ───────────────────────────────
    case 'STATUS_CHANGED': {
      const bk = await getBk()
      if (!bk) return

      // Group alert
      await sendToTransportGroup(
        msg.statusChangedMsg(bk, payload.newStatus, payload.byName)
      )

      // ❌ NO DM driver/messenger on status change (kept as toggle but default false)
      if (ENABLE_DRIVER_STATUS_DM) {
        const drvChat = await resolveAssignedDriverChatId(bk)
        if (drvChat) await sendDM(drvChat, msg.driverStatusDM(bk, payload.newStatus))
      }

      // DM employee (optional - stays ON)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeStatusDM(bk, payload.newStatus))
      }
      return
    }

    // ───────────────────────────────
    // 🚘 DRIVER ACKNOWLEDGE
    // ───────────────────────────────
    case 'DRIVER_ACK': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return

      const resp = String(payload.response || bk?.assignment?.driverAck || '')
        .toUpperCase()

      // Group alert
      await sendToTransportGroup(msg.driverAckGroupMsg(bk, resp))

      // ❌ NO DM driver/messenger confirm (kept as toggle but default false)
      if (ENABLE_DRIVER_ACK_DM) {
        const drvChat = await resolveAssignedDriverChatId(bk)
        if (drvChat) await sendDM(drvChat, msg.driverAckConfirmDM(bk, resp))
      }

      // DM employee (optional - stays ON)
      if (ENABLE_EMP_DM) {
        const empChat = await resolveEmployeeChatId(bk)
        if (empChat) await sendDM(empChat, msg.employeeDriverAckDM(bk, resp))
      }
      return
    }

    // ───────────────────────────────
    // 🔁 SERIES CREATED (Recurring Booking)
    // ───────────────────────────────
    case 'SERIES_CREATED': {
      const {
        seriesId,
        created = 0,
        skipped = 0,
        sampleDates = [],
        createdByEmp = {},
      } = payload

      // Group alert
      const text = [
        '🔁 <b>New Recurring Booking Series Created</b>',
        '======================================',
        `✅ Created: <b>${created}</b> bookings`,
        `🛑 Skipped: <b>${skipped}</b> (holidays/Sundays)`,
        sampleDates?.length ? `📅 Example skipped: ${sampleDates.join(', ')}` : null,
        '',
        '🟢 All generated trips are status <b>PENDING</b>.',
      ]
        .filter(Boolean)
        .join('\n')

      await sendToTransportGroup(text)

      // DM employee (summary)
      if (ENABLE_EMP_DM && createdByEmp?.employeeId) {
        try {
          const empChat = await resolveEmployeeChatId({
            employeeId: createdByEmp.employeeId,
          })
          if (empChat) {
            const dmText = [
              '🔁 <b>Your recurring transport request has been created</b>',
              `• Created <b>${created}</b> bookings`,
              `• Skipped <b>${skipped}</b> (holidays/Sundays)`,
              sampleDates?.length ? `• Example skipped: ${sampleDates.join(', ')}` : null,
              '✅ All trips are set to <b>PENDING</b>.',
            ]
              .filter(Boolean)
              .join('\n')
            await sendDM(empChat, dmText)
          }
        } catch (e) {
          console.error('[notify error] SERIES_CREATED DM', e.message)
        }
      }
      return
    }

    // ───────────────────────────────
    // ⛔ SERIES CANCELLED (Recurring Booking)
    // ───────────────────────────────
    case 'SERIES_CANCELLED': {
      const { seriesId, affected = 0 } = payload
      const text = [
        '⚠️ <b>Recurring Series Cancelled</b>',
        '======================================',
        `🚫 Future bookings cancelled: <b>${affected}</b>`,
      ].join('\n')

      await sendToTransportGroup(text)
      return
    }

    // ───────────────────────────────
    // default: do nothing
    // ───────────────────────────────
    default: {
      if (DEBUG) console.log('[notify] unhandled event', event)
      return
    }
  }
}

module.exports = { notify }
