/* eslint-disable no-console */
const mongoose = require('mongoose')
const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')

function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ''))
}

async function findUserByLoginOrId(id, ctx = {}) {
  const safe = String(id || '').trim()
  if (!safe) return null

  const safeLower = safe.toLowerCase()

  const ors = [
    { loginId: safe },
    { loginId: safeLower }, // ✅ important: fix case mismatch
  ]

  if (isObjId(safe)) ors.push({ _id: safe })

  try {
    const user = await User.findOne({ $or: ors }).lean()
    if (!user) {
      console.warn('[DM lookup] user not found', { id: safe, tried: ors, ...ctx })
      return null
    }
    return user
  } catch (e) {
    console.error('[DM lookup ✗] user query failed', { id: safe, tried: ors, error: e.message, ...ctx })
    return null
  }
}

async function resolveAssignedDriverChatId(bk) {
  const id = bk?.assignment?.driverId
  const bid = String(bk?._id || '')

  if (!id) {
    console.warn('[DM lookup] no assignment.driverId', { bookingId: bid })
    return ''
  }

  const user = await findUserByLoginOrId(id, { bookingId: bid, kind: 'driver' })
  if (!user) return ''

  if (!user.telegramChatId) {
    console.warn('[DM lookup] driver has no telegramChatId', { loginId: user.loginId, bookingId: bid })
    return ''
  }

  const chatId = String(user.telegramChatId)
  console.log('[DM lookup ✓ driver]', { loginId: user.loginId, chatId, bookingId: bid })
  return chatId
}

async function resolveAssignedAssigneeChatIds(bk) {
  const bid = String(bk?._id || '')

  const ids = [
    bk?.assignment?.driverId,
    bk?.assignment?.messengerId,
    bk?.assignment?.assigneeId,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)

  if (!ids.length) {
    console.warn('[DM lookup] no assignee ids on booking.assignment', { bookingId: bid })
    return []
  }

  const chatIds = []

  for (const id of ids) {
    const user = await findUserByLoginOrId(id, { bookingId: bid, kind: 'assignee' })
    if (!user) continue

    if (!user.telegramChatId) {
      console.warn('[DM lookup] assignee has no telegramChatId', { loginId: user.loginId, bookingId: bid })
      continue
    }

    chatIds.push(String(user.telegramChatId))
  }

  const unique = [...new Set(chatIds)]
  console.log('[DM lookup ✓ assignees]', { bookingId: bid, count: unique.length, ids })
  return unique
}

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
    console.log('[DM lookup ✓ employee]', { employeeId: empId, name: emp.name, chatId, bookingId: bid })
    return chatId
  } catch (e) {
    console.error('[DM lookup ✗] employee query failed', { employeeId: empId, bookingId: bid, error: e.message })
    return ''
  }
}

module.exports = {
  resolveAssignedDriverChatId,
  resolveAssignedAssigneeChatIds,
  resolveEmployeeChatId,
}
