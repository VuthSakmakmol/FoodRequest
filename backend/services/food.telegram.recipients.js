// backend/services/food.telegram.recipients.js
const User = require('../models/User')

/**
 * Return list of { loginId, chatId } for all CHEF users that have telegramChatId.
 */
async function listChefChatIds() {
  const chefs = await User.find(
    {
      role: 'CHEF',
      telegramChatId: { $exists: true, $ne: null, $ne: '' },
      isActive: { $ne: false },
    },
    { loginId: 1, telegramChatId: 1 }
  ).lean()

  return chefs.map((c) => ({
    loginId: c.loginId,
    chatId: String(c.telegramChatId),
  }))
}

module.exports = { listChefChatIds }
