// backend/services/transport.telegram.notify.js
const CarBooking = require('../models/transportation/CarBooking')
const { sendToTransportGroup, sendDM } = require('./transport.telegram.service')
const { resolveAssignedDriverChatId } = require('./transport.telegram.recipients')
const msg = require('./transport.telegram.messages')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

async function notify(event, payload) {
  if (DEBUG) console.log('[notify]', event, payload)

  const getBk = async () => {
    const bk = await CarBooking.findById(payload.bookingId).lean()
    if (!bk) console.warn('[notify] booking not found', { event, bookingId: String(payload.bookingId || '') })
    return bk
  }

  switch (event) {
    case 'REQUEST_CREATED': {
      const bk = await getBk(); if (!bk) return
      await sendToTransportGroup(msg.newRequestMsg(bk))
      return
    }
    case 'ADMIN_DECLINED': {
      const bk = await getBk(); if (!bk) return
      await sendToTransportGroup(msg.declinedMsg(bk, payload.reason, payload.byName))
      return
    }
    case 'ADMIN_ACCEPTED_ASSIGNED': {
      const bk = await getBk(); if (!bk) return
      await sendToTransportGroup(msg.acceptedAssignedMsg(bk))
      const chatId = await resolveAssignedDriverChatId(bk)
      if (DEBUG) console.log('[notify] resolved driver chatId', { chatId: chatId || null })
      if (chatId) await sendDM(chatId, msg.driverAssignmentDM(bk))
      return
    }
    case 'STATUS_CHANGED': {
      const bk = await getBk(); if (!bk) return
      await sendToTransportGroup(msg.statusChangedMsg(bk, payload.newStatus, payload.byName))
      const chatId = await resolveAssignedDriverChatId(bk)
      if (DEBUG) console.log('[notify] resolved driver chatId', { chatId: chatId || null })
      if (chatId) await sendDM(chatId, msg.driverStatusDM(bk, payload.newStatus))
      return
    }
  }
}

module.exports = { notify }
