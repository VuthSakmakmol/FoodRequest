/* eslint-disable no-console */
// backend/services/telegram/swap/swap.telegram.recipients.js

const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const User = require('../../../models/User')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function s(v) {
  return String(v ?? '').trim()
}

function isDigits(v) {
  return /^[0-9]+$/.test(s(v))
}

function logOk(label, key, chatId, requestId) {
  if (!DEBUG) return
  console.log(`[Swap DM lookup ✓ ${label}]`, {
    key,
    chatId,
    requestId: s(requestId),
  })
}

/**
 * Resolve chatId from:
 * 1) EmployeeDirectory if key is digits (employeeId)
 * 2) User if key is non-digits (loginId like leave_gm, leave_coo, manager loginId)
 */
async function resolveChatId(key, requestId, label) {
  const rid = s(requestId)
  const k = s(key)

  if (!k) {
    console.warn(`[Swap DM lookup] no ${label} key`, { requestId: rid })
    return ''
  }

  try {
    // employeeId path
    if (isDigits(k)) {
      const emp = await EmployeeDirectory.findOne(
        { employeeId: k },
        { employeeId: 1, telegramChatId: 1, name: 1, fullName: 1 }
      ).lean()

      if (!emp) {
        console.warn(`[Swap DM lookup] ${label} EmployeeDirectory not found`, { employeeId: k, requestId: rid })
        return ''
      }

      const chatId = s(emp.telegramChatId)
      if (!chatId) {
        console.warn(`[Swap DM lookup] ${label} employee has no telegramChatId`, { employeeId: k, requestId: rid })
        return ''
      }

      logOk(label, `emp:${k}`, chatId, rid)
      return chatId
    }

    // loginId path
    const user = await User.findOne({ loginId: k }, { loginId: 1, telegramChatId: 1, name: 1 }).lean()

    if (!user) {
      console.warn(`[Swap DM lookup] ${label} User not found`, { loginId: k, requestId: rid })
      return ''
    }

    const chatId = s(user.telegramChatId)
    if (!chatId) {
      console.warn(`[Swap DM lookup] ${label} user has no telegramChatId`, { loginId: k, requestId: rid })
      return ''
    }

    logOk(label, `user:${k}`, chatId, rid)
    return chatId
  } catch (e) {
    console.error(`[Swap DM lookup ✗] ${label} resolve failed`, { key: k, requestId: rid, error: e.message })
    return ''
  }
}

/* Convenience helpers */
async function resolveEmployeeChatId(doc) {
  return resolveChatId(doc?.employeeId, doc?._id, 'employee')
}
async function resolveManagerChatId(doc) {
  return resolveChatId(doc?.managerLoginId, doc?._id, 'manager')
}
async function resolveGmChatId(doc) {
  return resolveChatId(doc?.gmLoginId, doc?._id, 'gm')
}
async function resolveCooChatId(doc) {
  return resolveChatId(doc?.cooLoginId, doc?._id, 'coo')
}

module.exports = {
  resolveChatId,
  resolveEmployeeChatId,
  resolveManagerChatId,
  resolveGmChatId,
  resolveCooChatId,
}