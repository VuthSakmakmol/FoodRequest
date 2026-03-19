/* eslint-disable no-console */
const EmployeeDirectory = require('../../../models/EmployeeDirectory')
const User = require('../../../models/User')

const {
  buildLeaveContractReminderMessage,
} = require('./leave.contractReminder.messages')

function s(v) {
  return String(v ?? '').trim()
}

const BOT_TOKEN = s(process.env.TELEGRAM_BOT_TOKEN)

async function telegramSend(chatId, text) {
  const id = s(chatId)
  if (!BOT_TOKEN) {
    console.warn('[leave.contractReminder.notify] Missing TELEGRAM_BOT_TOKEN')
    return false
  }
  if (!id) return false
  if (!text) return false

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    const json = await res.json().catch(() => null)

    if (!res.ok || !json?.ok) {
      console.warn('[leave.contractReminder.notify] Telegram API failed:', {
        chatId: id,
        status: res.status,
        response: json,
      })
      return false
    }

    return true
  } catch (err) {
    console.warn('[leave.contractReminder.notify] Telegram send error:', err?.message)
    return false
  }
}

async function resolveAdminRecipients() {
  const users = await User.find(
    {
      roles: { $in: ['LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'] },
      isActive: true,
    },
    { loginId: 1, name: 1, telegramChatId: 1, roles: 1, role: 1 }
  ).lean()

  const loginIds = users.map((u) => s(u.loginId)).filter(Boolean)

  const emps = loginIds.length
    ? await EmployeeDirectory.find(
        { employeeId: { $in: loginIds } },
        {
          employeeId: 1,
          name: 1,
          fullName: 1,
          department: 1,
          telegramChatId: 1,
        }
      ).lean()
    : []

  const empMap = new Map(
    emps.map((e) => [
      s(e.employeeId),
      {
        employeeId: s(e.employeeId),
        name: s(e.name || e.fullName),
        department: s(e.department),
        telegramChatId: s(e.telegramChatId),
      },
    ])
  )

  return users
    .map((u) => {
      const loginId = s(u.loginId)
      const emp = empMap.get(loginId)

      return {
        employeeId: loginId,
        name: s(emp?.name || u.name),
        department: s(emp?.department),
        telegramChatId: s(u.telegramChatId || emp?.telegramChatId),
        role: 'ADMIN',
      }
    })
    .filter((x) => x.telegramChatId)
}

async function sendLeaveContractReminder({
  profile,
  contract,
  daysLeft,
  reminderType,
  employee,
  manager,
}) {
  const employeeId = s(profile?.employeeId)
  const employeeName = s(employee?.name || employee?.fullName)
  const department = s(employee?.department)
  const endDate = s(contract?.endDate || profile?.contractEndDate)
  const contractNo = Number(contract?.contractNo || 0) || ''

  const text = buildLeaveContractReminderMessage({
    employeeId,
    employeeName,
    department,
    endDate,
    daysLeft,
    contractNo,
    reminderType,
  })

  const sentTo = []

  const admins = await resolveAdminRecipients()
  console.log('[leave.contractReminder.notify] admins:', admins)

  for (const admin of admins) {
    const ok = await telegramSend(admin.telegramChatId, text)
    if (ok) sentTo.push(`admin:${admin.employeeId}`)
  }

  if (s(manager?.telegramChatId)) {
    const ok = await telegramSend(manager.telegramChatId, text)
    if (ok) sentTo.push(`manager:${s(manager.employeeId)}`)
  }

  console.log('[leave.contractReminder.notify] sentTo:', sentTo)

  return {
    ok: true,
    sentTo,
  }
}

module.exports = {
  sendLeaveContractReminder,
}