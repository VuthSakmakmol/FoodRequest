/* eslint-disable no-console */
const dayjs = require('dayjs')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const LeaveContractReminderLog = require('../../models/leave/LeaveContractReminderLog')

const {
  sendLeaveContractReminder,
} = require('../telegram/leave/leave.contractReminder.notify')

function s(v) {
  return String(v ?? '').trim()
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}

function latestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null

  const valid = arr.filter((c) => isValidYMD(c?.startDate))
  if (valid.length) {
    return valid.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  }

  return arr.slice().sort((a, b) => num(b.contractNo) - num(a.contractNo))[0]
}

function diffDaysFromToday(endDateYMD) {
  const today = dayjs().startOf('day')
  const end = dayjs(endDateYMD, 'YYYY-MM-DD', true).startOf('day')
  if (!end.isValid()) return null
  return end.diff(today, 'day')
}

function reminderTypeFromDaysLeft(daysLeft) {
  if (daysLeft === 30) return 'D30'
  if (daysLeft === 14) return 'D14'
  if (daysLeft === 7) return 'D7'
  if (daysLeft === 1) return 'D1'
  return ''
}

async function enrichProfile(profile) {
  const employeeId = s(profile?.employeeId)
  const managerLoginId = s(profile?.managerLoginId)

  let employee = null
  let manager = null

  if (employeeId) {
    employee = await EmployeeDirectory.findOne(
      { employeeId },
      { employeeId: 1, name: 1, fullName: 1, department: 1, telegramChatId: 1 }
    ).lean()
  }

  if (managerLoginId) {
    manager = await EmployeeDirectory.findOne(
      { employeeId: managerLoginId },
      { employeeId: 1, name: 1, fullName: 1, department: 1, telegramChatId: 1 }
    ).lean()
  }

  return {
    employee: employee || null,
    manager: manager || null,
  }
}

async function getCurrentLeaveContractReminders() {
  const rows = await LeaveProfile.find(
    { isActive: true },
    {
      employeeId: 1,
      managerLoginId: 1,
      contracts: 1,
      contractDate: 1,
      contractEndDate: 1,
      employeeLoginId: 1,
      isActive: 1,
    }
  ).lean()

  const out = []

  for (const profile of rows) {
    const contract = latestContract(profile?.contracts || [])
    const contractNo = num(contract?.contractNo || 0)
    const endDate = s(contract?.endDate || profile?.contractEndDate)

    if (!contractNo || !isValidYMD(endDate)) continue

    const daysLeft = diffDaysFromToday(endDate)
    if (daysLeft == null) continue

    // show upcoming within 30 days, plus overdue active ones
    if (daysLeft > 30) continue

    const reminderType = reminderTypeFromDaysLeft(daysLeft)

    const extra = await enrichProfile(profile)

    out.push({
      employeeId: s(profile.employeeId),
      employeeName: s(extra.employee?.name || extra.employee?.fullName || ''),
      name: s(extra.employee?.name || extra.employee?.fullName || ''),
      department: s(extra.employee?.department || ''),
      managerLoginId: s(profile.managerLoginId),
      contractNo,
      startDate: s(contract?.startDate || profile?.contractDate),
      endDate,
      daysLeft,
      reminderType: reminderType || (daysLeft < 0 ? 'OVERDUE' : 'UPCOMING'),
    })
  }

  return out.sort((a, b) => {
    const da = num(a?.daysLeft, 9999)
    const db = num(b?.daysLeft, 9999)
    if (da !== db) return da - db
    return s(a?.employeeId).localeCompare(s(b?.employeeId))
  })
}

async function runLeaveContractReminderJob() {
  const rows = await LeaveProfile.find(
    { isActive: true },
    {
      employeeId: 1,
      managerLoginId: 1,
      approvalMode: 1,
      contracts: 1,
      contractDate: 1,
      contractEndDate: 1,
      employeeLoginId: 1,
      isActive: 1,
    }
  ).lean()

  const results = {
    checked: 0,
    matched: 0,
    sent: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    errors: 0,
  }

  for (const profile of rows) {
    results.checked += 1

    try {
      const contract = latestContract(profile?.contracts || [])
      const contractNo = num(contract?.contractNo || 0)
      const endDate = s(contract?.endDate || profile?.contractEndDate)

      if (!contractNo || !isValidYMD(endDate)) {
        results.skippedInvalid += 1
        continue
      }

      const daysLeft = diffDaysFromToday(endDate)
      const reminderType = reminderTypeFromDaysLeft(daysLeft)

      if (!reminderType) continue
      results.matched += 1

      const employeeId = s(profile.employeeId)

      const exists = await LeaveContractReminderLog.findOne({
        employeeId,
        contractNo,
        reminderType,
      }).lean()

      if (exists) {
        results.skippedDuplicate += 1
        continue
      }

      const extra = await enrichProfile(profile)

      const notifyResult = await sendLeaveContractReminder({
        profile,
        contract,
        daysLeft,
        reminderType,
        employee: extra.employee,
        manager: extra.manager,
      })

      if (!Array.isArray(notifyResult?.sentTo) || !notifyResult.sentTo.length) {
        throw new Error(
          `No Telegram recipient sent successfully for employeeId=${employeeId}, contractNo=${contractNo}, reminderType=${reminderType}`
        )
      }

      await LeaveContractReminderLog.create({
        employeeId,
        contractNo,
        reminderType,
        contractEndDate: endDate,
        sentAt: new Date(),
        sentTo: notifyResult.sentTo,
        note: `daysLeft=${daysLeft}`,
      })

      results.sent += 1
    } catch (err) {
      results.errors += 1
      console.error('leave contract reminder error:', {
        employeeId: profile?.employeeId,
        message: err?.message,
        stack: err?.stack,
      })
    }
  }

  return results
}

module.exports = {
  runLeaveContractReminderJob,
  getCurrentLeaveContractReminders,
}