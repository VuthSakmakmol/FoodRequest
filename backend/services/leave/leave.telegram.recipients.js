/* eslint-disable no-console */
const mongoose = require('mongoose')
const User = require('../../models/User')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function isObjId(v) {
  try {
    return mongoose.Types.ObjectId.isValid(String(v || ''))
  } catch {
    return false
  }
}

/* ──────────────────────────────────────────────
 * Manager chat ID (loginId = managerLoginId)
 * ────────────────────────────────────────────── */
async function resolveManagerChatId(reqDoc) {
  const loginId = reqDoc?.managerLoginId
  const rid = String(reqDoc?._id || '')

  if (!loginId) {
    console.warn('[Leave DM lookup] no managerLoginId', { requestId: rid })
    return ''
  }

  const ors = [{ loginId }]
  if (isObjId(loginId)) ors.push({ _id: loginId })

  let user
  try {
    user = await User.findOne({ $or: ors }).lean()
  } catch (e) {
    console.error('[Leave DM lookup ✗] manager query failed', {
      loginId,
      requestId: rid,
      error: e.message,
    })
    return ''
  }

  if (!user) {
    console.warn('[Leave DM lookup] manager user not found', {
      loginId,
      requestId: rid,
      tried: ors,
    })
    return ''
  }

  if (!user.telegramChatId) {
    console.warn('[Leave DM lookup] manager has no telegramChatId', {
      loginId: user.loginId,
      requestId: rid,
    })
    return ''
  }

  const chatId = String(user.telegramChatId)
  if (DEBUG) {
    console.log('[Leave DM lookup ✓ manager]', {
      loginId: user.loginId,
      chatId,
      requestId: rid,
    })
  }
  return chatId
}

/* ──────────────────────────────────────────────
 * GM chat ID (loginId = gmLoginId)
 * ────────────────────────────────────────────── */
async function resolveGmChatId(reqDoc) {
  const loginId = reqDoc?.gmLoginId
  const rid = String(reqDoc?._id || '')

  if (!loginId) {
    console.warn('[Leave DM lookup] no gmLoginId', { requestId: rid })
    return ''
  }

  const ors = [{ loginId }]
  if (isObjId(loginId)) ors.push({ _id: loginId })

  let user
  try {
    user = await User.findOne({ $or: ors }).lean()
  } catch (e) {
    console.error('[Leave DM lookup ✗] gm query failed', {
      loginId,
      requestId: rid,
      error: e.message,
    })
    return ''
  }

  if (!user) {
    console.warn('[Leave DM lookup] gm user not found', {
      loginId,
      requestId: rid,
      tried: ors,
    })
    return ''
  }

  if (!user.telegramChatId) {
    console.warn('[Leave DM lookup] gm has no telegramChatId', {
      loginId: user.loginId,
      requestId: rid,
    })
    return ''
  }

  const chatId = String(user.telegramChatId)
  if (DEBUG) {
    console.log('[Leave DM lookup ✓ gm]', {
      loginId: user.loginId,
      chatId,
      requestId: rid,
    })
  }
  return chatId
}

/* ──────────────────────────────────────────────
 * Employee chat ID (loginId = employeeId/requesterLoginId)
 * ────────────────────────────────────────────── */
async function resolveEmployeeChatId(reqDoc) {
  const loginId = reqDoc?.employeeId || reqDoc?.requesterLoginId
  const rid = String(reqDoc?._id || '')

  if (!loginId) {
    console.warn('[Leave DM lookup] request missing employee/loginId', {
      requestId: rid,
    })
    return ''
  }

  const ors = [{ loginId }]
  if (isObjId(loginId)) ors.push({ _id: loginId })

  let user
  try {
    user = await User.findOne({ $or: ors }).lean()
  } catch (e) {
    console.error('[Leave DM lookup ✗] employee query failed', {
      loginId,
      requestId: rid,
      error: e.message,
    })
    return ''
  }

  if (!user) {
    console.warn('[Leave DM lookup] employee user not found', {
      loginId,
      requestId: rid,
      tried: ors,
    })
    return ''
  }

  if (!user.telegramChatId) {
    console.warn('[Leave DM lookup] employee has no telegramChatId', {
      loginId: user.loginId,
      requestId: rid,
    })
    return ''
  }

  const chatId = String(user.telegramChatId)
  if (DEBUG) {
    console.log('[Leave DM lookup ✓ employee]', {
      loginId: user.loginId,
      chatId,
      requestId: rid,
    })
  }
  return chatId
}

module.exports = {
  resolveManagerChatId,
  resolveGmChatId,
  resolveEmployeeChatId,
}
