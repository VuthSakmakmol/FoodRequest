// backend/services/transport.telegram.recipients.js
/* eslint-disable no-console */
const mongoose = require('mongoose')
const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')

// ──────────────────────────────────────────────
// Utility: check valid ObjectId
// ──────────────────────────────────────────────
function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ''))
}

// ──────────────────────────────────────────────
// Resolve chat ID of assigned DRIVER
// ──────────────────────────────────────────────
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
    console.error('[DM lookup ✗] driver query failed', { driverId: id, bookingId: bid, error: e.message })
    return ''
  }

  if (!user) {
    console.warn('[DM lookup] driver user not found', { driverId: id, bookingId: bid, tried: ors })
    return ''
  }
  if (!user.telegramChatId) {
    console.warn('[DM lookup] driver has no telegramChatId', { loginId: user.loginId, bookingId: bid })
    return ''
  }

  const chatId = String(user.telegramChatId)
  console.log('[DM lookup ✓ driver]', { loginId: user.loginId, chatId, bookingId: bid })
  return chatId
}

// ──────────────────────────────────────────────
// Resolve chat ID of requesting EMPLOYEE
// ──────────────────────────────────────────────
async function resolveEmployeeChatId(bk) {
  const empId = bk?.employeeId || bk?.employee?.employeeId
  const bid = String(bk?._id || '')

  if (!empId) {
    console.warn('[DM lookup] booking missing employeeId', { bookingId: bid })
    return ''
  }

  try {
    const emp = await EmployeeDirectory.findOne(
      { employeeId: empId },
      { telegramChatId: 1, telegramUsername: 1, name: 1 }
    ).lean()

    if (!emp) {
      console.warn('[DM lookup] employee not found', { employeeId: empId, bookingId: bid })
      return ''
    }

    if (!emp.telegramChatId) {
      console.warn('[DM lookup] employee has no telegramChatId', { employeeId: empId, bookingId: bid })
      return ''
    }

    const chatId = String(emp.telegramChatId)
    console.log('[DM lookup ✓ employee]', {
      employeeId: empId,
      name: emp.name,
      chatId,
      bookingId: bid,
    })
    return chatId
  } catch (e) {
    console.error('[DM lookup ✗] employee query failed', {
      employeeId: empId,
      bookingId: bid,
      error: e.message,
    })
    return ''
  }
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────
module.exports = {
  resolveAssignedDriverChatId,
  resolveEmployeeChatId,
}
