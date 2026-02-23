// backend/services/telegram/swap/swap.telegram.service.js
/* eslint-disable no-console */
const { sendDM } = require('../core/telegram.http')

async function sendSwapDM(chatId, text, opts = {}) {
  return sendDM(chatId, text, opts)
}

module.exports = { sendSwapDM }