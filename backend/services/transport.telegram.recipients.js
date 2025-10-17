// backend/services/transport.telegram.recipients.js
const User = require('../models/User')

async function resolveAssignedDriverChatId(bk) {
  const id = bk?.assignment?.driverId
  if (!id) return ''
  // Support both Mongo _id and loginId (your controller uses loginId)
  const u = await User.findOne({ $or: [{ _id: id }, { loginId: id }] }).lean()
  return (u && u.telegramChatId) ? String(u.telegramChatId) : ''
}

module.exports = { resolveAssignedDriverChatId }
