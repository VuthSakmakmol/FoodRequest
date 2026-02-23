/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.recipients.js

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
  console.log(`[Leave DM lookup ✓ ${label}]`, { key, chatId, requestId: s(requestId) })
}

async function resolveChatId(key, requestId, label) {
  const rid = s(requestId)
  const k = s(key)
  if (!k) return ''

  try {
    if (isDigits(k)) {
      const emp = await EmployeeDirectory.findOne(
        { employeeId: k },
        { employeeId: 1, telegramChatId: 1 }
      ).lean()
      const chatId = s(emp?.telegramChatId)
      if (!chatId) return ''
      logOk(label, `emp:${k}`, chatId, rid)
      return chatId
    }

    const user = await User.findOne({ loginId: k }, { loginId: 1, telegramChatId: 1 }).lean()
    const chatId = s(user?.telegramChatId)
    if (!chatId) return ''
    logOk(label, `user:${k}`, chatId, rid)
    return chatId
  } catch (e) {
    console.error(`[Leave DM lookup ✗] ${label} resolve failed`, { key: k, requestId: rid, error: e.message })
    return ''
  }
}

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

async function resolveAdminChatIds(requestId) {
  const rid = s(requestId)
  try {
    const rows = await User.find(
      { role: { $in: ['LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'] }, telegramChatId: { $exists: true, $ne: '' } },
      { loginId: 1, telegramChatId: 1 }
    ).lean()

    const ids = [...new Set((rows || []).map((u) => s(u.telegramChatId)).filter(Boolean))]

    if (DEBUG) console.log('[Leave DM lookup ✓ admins]', { count: ids.length, requestId: rid })
    return ids
  } catch (e) {
    console.error('[Leave DM lookup ✗ admins] failed', { requestId: rid, error: e.message })
    return []
  }
}

module.exports = {
  resolveChatId,
  resolveEmployeeChatId,
  resolveManagerChatId,
  resolveGmChatId,
  resolveCooChatId,
  resolveAdminChatIds,
}