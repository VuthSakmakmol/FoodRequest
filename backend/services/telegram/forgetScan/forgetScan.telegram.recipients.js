/* eslint-disable no-console */
// backend/services/telegram/forgetScan/forgetScan.telegram.recipients.js

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
  console.log(`[ForgetScan DM lookup ✓ ${label}]`, { key, chatId, requestId: s(requestId) })
}

async function resolveChatId(key, requestId, label) {
  const rid = s(requestId)
  const k = s(key)

  if (!k) {
    console.warn(`[ForgetScan DM lookup] no ${label} key`, { requestId: rid })
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
        console.warn(`[ForgetScan DM lookup] ${label} EmployeeDirectory not found`, { employeeId: k, requestId: rid })
        return ''
      }

      const chatId = s(emp.telegramChatId)
      if (!chatId) {
        console.warn(`[ForgetScan DM lookup] ${label} employee has no telegramChatId`, { employeeId: k, requestId: rid })
        return ''
      }

      logOk(label, `emp:${k}`, chatId, rid)
      return chatId
    }

    // loginId path (leave_admin / leave_gm / leave_coo etc.)
    const user = await User.findOne({ loginId: k }, { loginId: 1, telegramChatId: 1, role: 1 }).lean()
    if (!user) {
      console.warn(`[ForgetScan DM lookup] ${label} User not found`, { loginId: k, requestId: rid })
      return ''
    }

    const chatId = s(user.telegramChatId)
    if (!chatId) {
      console.warn(`[ForgetScan DM lookup] ${label} user has no telegramChatId`, { loginId: k, requestId: rid })
      return ''
    }

    logOk(label, `user:${k}`, chatId, rid)
    return chatId
  } catch (e) {
    console.error(`[ForgetScan DM lookup ✗] ${label} resolve failed`, { key: k, requestId: rid, error: e.message })
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
      { loginId: 1, telegramChatId: 1, role: 1 }
    ).lean()

    const ids = [...new Set((rows || []).map((u) => s(u.telegramChatId)).filter(Boolean))]

    if (DEBUG) {
      console.log('[ForgetScan DM lookup ✓ admins]', {
        count: ids.length,
        requestId: rid,
        admins: (rows || []).map((u) => u.loginId),
      })
    }

    return ids
  } catch (e) {
    console.error('[ForgetScan DM lookup ✗ admins] failed', { requestId: rid, error: e.message })
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