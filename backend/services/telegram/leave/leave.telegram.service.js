/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.service.js

const { sendDM } = require('../core/telegram.http')

async function sendLeaveDM(chatId, text, opts = {}) {
  return sendDM(chatId, text, opts)
}

module.exports = { sendLeaveDM }