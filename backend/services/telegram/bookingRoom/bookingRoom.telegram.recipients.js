/* eslint-disable no-console */
// backend/services/telegram/bookingRoom/bookingRoom.telegram.recipients.js

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const User = require('../../../models/User')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function logOk(label, key, chatId, requestId) {
  if (!DEBUG) return
  console.log(`[BookingRoom DM lookup ✓ ${label}]`, {
    key,
    chatId,
    requestId: s(requestId),
  })
}

async function resolveEmployeeChatId(doc) {
  const rid = s(doc?._id)
  const employeeId = s(doc?.employeeId)

  if (!employeeId) {
    console.warn('[BookingRoom DM lookup] no employeeId', { requestId: rid })
    return ''
  }

  try {
    const emp = await EmployeeDirectory.findOne(
      { employeeId },
      { employeeId: 1, telegramChatId: 1, name: 1, fullName: 1 }
    ).lean()

    if (!emp) {
      console.warn('[BookingRoom DM lookup] employee not found', { employeeId, requestId: rid })
      return ''
    }

    const chatId = s(emp.telegramChatId)
    if (!chatId) {
      console.warn('[BookingRoom DM lookup] employee has no telegramChatId', { employeeId, requestId: rid })
      return ''
    }

    logOk('employee', `emp:${employeeId}`, chatId, rid)
    return chatId
  } catch (e) {
    console.error('[BookingRoom DM lookup ✗ employee resolve failed]', {
      employeeId,
      requestId: rid,
      error: e.message,
    })
    return ''
  }
}

async function resolveUsersByRole(role, requestId) {
  const r = up(role)
  if (!r) return []

  try {
    const users = await User.find(
      {
        isActive: true,
        roles: r,
      },
      { loginId: 1, telegramChatId: 1, name: 1, roles: 1 }
    ).lean()

    const out = []
    for (const u of users || []) {
      const chatId = s(u.telegramChatId)
      if (!chatId) continue

      out.push({
        loginId: s(u.loginId),
        name: s(u.name),
        chatId,
      })

      logOk(`${r.toLowerCase()}-user`, `user:${s(u.loginId)}`, chatId, requestId)
    }

    return out
  } catch (e) {
    console.error(`[BookingRoom DM lookup ✗ ${r} resolve failed]`, {
      requestId: s(requestId),
      error: e.message,
    })
    return []
  }
}

async function resolveRoomAdminRecipients(doc) {
  return resolveUsersByRole('ROOM_ADMIN', doc?._id)
}

async function resolveMaterialAdminRecipients(doc) {
  return resolveUsersByRole('MATERIAL_ADMIN', doc?._id)
}

module.exports = {
  resolveEmployeeChatId,
  resolveRoomAdminRecipients,
  resolveMaterialAdminRecipients,
}