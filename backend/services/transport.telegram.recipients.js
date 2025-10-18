// backend/services/transport.telegram.recipients.js
const mongoose = require('mongoose')
const User = require('../models/User')

function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ''))
}

async function resolveAssignedDriverChatId(bk) {
  const id = bk?.assignment?.driverId
  const bid = String(bk?._id || '')
  if (!id) {
    console.warn('[DM lookup] no assignment.driverId', { bookingId: bid })
    return ''
  }

  // Build safe OR query without causing ObjectId cast errors
  const ors = [{ loginId: id }]
  if (isObjId(id)) ors.push({ _id: id })

  let user
  try {
    user = await User.findOne({ $or: ors }).lean()
  } catch (e) {
    console.error('[DM lookup ✗] query failed', { driverId: id, bookingId: bid, error: e.message })
    return ''
  }

  if (!user) {
    console.warn('[DM lookup] user not found', { driverId: id, bookingId: bid, tried: ors })
    return ''
  }
  if (!user.telegramChatId) {
    console.warn('[DM lookup] user has no telegramChatId', { loginId: user.loginId, bookingId: bid })
    return ''
  }

  const chatId = String(user.telegramChatId)
  console.log('[DM lookup ✓]', { loginId: user.loginId, chatId, bookingId: bid })
  return chatId
}

module.exports = { resolveAssignedDriverChatId }
