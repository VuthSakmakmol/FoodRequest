/* eslint-disable no-console */
//backend/services/leave/leave.telegram.reciepents.js
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

async function findUserByLoginOrId(loginId, requestId, label) {
  const clean = String(loginId || '').trim()
  const rid = String(requestId || '')

  if (!clean) {
    console.warn(`[Leave DM lookup] no ${label} loginId`, { requestId: rid })
    return null
  }

  const ors = [{ loginId: clean }]
  if (isObjId(clean)) ors.push({ _id: clean })

  try {
    const user = await User.findOne({ $or: ors }).lean()
    if (!user) {
      console.warn(`[Leave DM lookup] ${label} user not found`, {
        loginId: clean,
        requestId: rid,
        tried: ors,
      })
      return null
    }
    return user
  } catch (e) {
    console.error(`[Leave DM lookup ✗] ${label} query failed`, {
      loginId: clean,
      requestId: rid,
      error: e.message,
    })
    return null
  }
}

function logOk(label, user, chatId, requestId) {
  if (!DEBUG) return
  console.log(`[Leave DM lookup ✓ ${label}]`, {
    loginId: user?.loginId,
    chatId,
    requestId: String(requestId || ''),
  })
}

/* ──────────────────────────────────────────────
 * Manager chat ID
 * ────────────────────────────────────────────── */
async function resolveManagerChatId(reqDoc) {
  const rid = String(reqDoc?._id || '')
  const user = await findUserByLoginOrId(reqDoc?.managerLoginId, rid, 'manager')
  if (!user?.telegramChatId) {
    if (user) console.warn('[Leave DM lookup] manager has no telegramChatId', { loginId: user.loginId, requestId: rid })
    return ''
  }
  const chatId = String(user.telegramChatId)
  logOk('manager', user, chatId, rid)
  return chatId
}

/* ──────────────────────────────────────────────
 * GM chat ID
 * ────────────────────────────────────────────── */
async function resolveGmChatId(reqDoc) {
  const rid = String(reqDoc?._id || '')
  const user = await findUserByLoginOrId(reqDoc?.gmLoginId, rid, 'gm')
  if (!user?.telegramChatId) {
    if (user) console.warn('[Leave DM lookup] gm has no telegramChatId', { loginId: user.loginId, requestId: rid })
    return ''
  }
  const chatId = String(user.telegramChatId)
  logOk('gm', user, chatId, rid)
  return chatId
}

/* ──────────────────────────────────────────────
 * COO chat ID ✅ NEW
 * ────────────────────────────────────────────── */
async function resolveCooChatId(reqDoc) {
  const rid = String(reqDoc?._id || '')
  const user = await findUserByLoginOrId(reqDoc?.cooLoginId, rid, 'coo')
  if (!user?.telegramChatId) {
    if (user) console.warn('[Leave DM lookup] coo has no telegramChatId', { loginId: user.loginId, requestId: rid })
    return ''
  }
  const chatId = String(user.telegramChatId)
  logOk('coo', user, chatId, rid)
  return chatId
}

/* ──────────────────────────────────────────────
 * Employee chat ID
 * ────────────────────────────────────────────── */
async function resolveEmployeeChatId(reqDoc) {
  const rid = String(reqDoc?._id || '')
  const loginId = reqDoc?.employeeId || reqDoc?.requesterLoginId
  const user = await findUserByLoginOrId(loginId, rid, 'employee')
  if (!user?.telegramChatId) {
    if (user) console.warn('[Leave DM lookup] employee has no telegramChatId', { loginId: user.loginId, requestId: rid })
    return ''
  }
  const chatId = String(user.telegramChatId)
  logOk('employee', user, chatId, rid)
  return chatId
}

module.exports = {
  resolveManagerChatId,
  resolveGmChatId,
  resolveCooChatId,        // ✅ export
  resolveEmployeeChatId,
}
