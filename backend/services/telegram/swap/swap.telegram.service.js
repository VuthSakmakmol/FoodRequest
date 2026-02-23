/* eslint-disable no-console */
// backend/services/telegram/swap/swap.telegram.service.js

const { sendDM } = require('../core/telegram.http')

async function sendSwapDM(chatId, text, opts = {}) {
  return sendDM(chatId, text, opts)
}

module.exports = { sendSwapDM }