/* backend/services/telegram/bookingRoom/bookingRoom.telegram.service*/
/* eslint-disable no-console */
const { sendDM } = require('../core/telegram.http')

async function sendBookingRoomDM(chatId, text, opts = {}) {
  return sendDM(chatId, text, opts)
}

module.exports = { sendBookingRoomDM }