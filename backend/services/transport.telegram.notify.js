// backend/services/transport.telegram.notify.js
const CarBooking = require('../models/transportation/CarBooking')
const { sendToTransportGroup, sendDM } = require('./transport.telegram.service')
const { resolveAssignedDriverChatId } = require('./transport.telegram.recipients')
const msg = require('./transport.telegram.messages')

/**
 * Events:
 * - REQUEST_CREATED           { bookingId, employeeName? }
 * - ADMIN_DECLINED            { bookingId, reason, byName }
 * - ADMIN_ACCEPTED_ASSIGNED   { bookingId, byName }
 * - STATUS_CHANGED            { bookingId, newStatus, byName }
 * - SERIES_CREATED            { seriesId, created, skipped, sampleDates? }   (optional)
 * - SERIES_CANCELLED          { seriesId, affected }                          (optional)
 */
async function notify(event, payload) {
  switch (event) {
    case 'REQUEST_CREATED': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return
      await sendToTransportGroup(msg.newRequestMsg(bk))
      return
    }

    case 'ADMIN_DECLINED': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return
      await sendToTransportGroup(msg.declinedMsg(bk, payload.reason, payload.byName))
      return
    }

    case 'ADMIN_ACCEPTED_ASSIGNED': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return
      await sendToTransportGroup(msg.acceptedAssignedMsg(bk))
      const chatId = await resolveAssignedDriverChatId(bk)
      if (chatId) await sendDM(chatId, msg.driverAssignmentDM(bk))
      return
    }

    case 'STATUS_CHANGED': {
      const bk = await CarBooking.findById(payload.bookingId).lean()
      if (!bk) return
      await sendToTransportGroup(msg.statusChangedMsg(bk, payload.newStatus, payload.byName))
      const chatId = await resolveAssignedDriverChatId(bk)
      if (chatId) await sendDM(chatId, msg.statusChangedMsg(bk, payload.newStatus, payload.byName))
      return
    }

    // Series events are optional – uncomment if you want group summaries:
    // case 'SERIES_CREATED': { ... }
    // case 'SERIES_CANCELLED': { ... }
  }
}

module.exports = { notify }
