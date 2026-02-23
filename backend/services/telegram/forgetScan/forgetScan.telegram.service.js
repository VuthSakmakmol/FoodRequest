/* eslint-disable no-console */
// backend/services/telegram/forgetScan/forgetScan.telegram.service.js

const { sendDM } = require('../core/telegram.http')

async function sendForgetScanDM(chatId, text, opts = {}) {
  return sendDM(chatId, text, opts)
}

module.exports = { sendForgetScanDM }