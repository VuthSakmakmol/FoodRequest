/* eslint-disable no-console */
// backend/services/leave/leave.contractReminder.service.js
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
function up(v) {
  return s(v).toUpperCase()
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

/**
 * Visible in UI when contract is within 30 days or overdue.
 */
function isVisibleReminderWindow(daysLeft) {
  return Number.isFinite(daysLeft) && daysLeft <= 30
}

/**
 * Stage bucket from live countdown:
 * 30..15 => D30
 * 14..8  => D14
 * 7..2   => D7
 * 1..-∞  => D1
 */
function stageFromDaysLeft(daysLeft) {
  const d = num(daysLeft, 999999)

  if (d <= 1) return 'D1'
  if (d <= 7) return 'D7'
  if (d <= 14) return 'D14'
  if (d <= 30) return 'D30'
  return ''
}

function reminderStageDays(reminderType) {
  const t = up(reminderType)
  if (t === 'D30') return 30
  if (t === 'D14') return 14
  if (t === 'D7') return 7
  if (t === 'D1') return 1
  return 0
}

function urgencyKeyFromDaysLeft(daysLeft) {
  const d = num(daysLeft, 999999)
  if (d < 0) return 'OVERDUE'
  if (d === 0) return 'CRITICAL'
  if (d <= 1) return 'CRITICAL'
  if (d <= 7) return 'URGENT'
  if (d <= 14) return 'WARNING'
  return 'UPCOMING'
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

async function getReminderLogMapForProfiles(rows) {
  const employeeIds = [...new Set((rows || []).map((x) => s(x?.employeeId)).filter(Boolean))]
  if (!employeeIds.length) return new Map()

  const logs = await LeaveContractReminderLog.find(
    { employeeId: { $in: employeeIds } },
    {
      employeeId: 1,
      contractNo: 1,
      reminderType: 1,
      sentAt: 1,
      contractEndDate: 1,
    }
  )
    .sort({ sentAt: -1, createdAt: -1 })
    .lean()

  const map = new Map()

  for (const log of logs) {
    const key = `${s(log.employeeId)}::${num(log.contractNo)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(log)
  }

  return map
}

function hasReminderLog(logs = [], reminderType) {
  const want = up(reminderType)
  return (Array.isArray(logs) ? logs : []).some((x) => up(x?.reminderType) === want)
}

function findLatestLog(logs = [], reminderType) {
  const want = up(reminderType)
  return (Array.isArray(logs) ? logs : []).find((x) => up(x?.reminderType) === want) || null
}

/**
 * Send once per stage only.
 * If exact day was missed, it can still send once while inside that stage window.
 */
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
    }
  ).lean()

  const logMap = await getReminderLogMapForProfiles(rows)

  const results = {
    checked: 0,
    matched: 0,
    sent: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    skippedNotInWindow: 0,
    errors: 0,
  }

  for (const profile of rows) {
    results.checked += 1

    try {
      const contract = latestContract(profile.contracts || [])
      const contractNo = num(contract?.contractNo || 0)
      const endDate = s(contract?.endDate || profile?.contractEndDate)

      if (!contractNo || !isValidYMD(endDate)) {
        results.skippedInvalid += 1
        continue
      }

      const daysLeft = diffDaysFromToday(endDate)
      if (!Number.isFinite(daysLeft)) {
        results.skippedInvalid += 1
        continue
      }

      if (!isVisibleReminderWindow(daysLeft)) {
        results.skippedNotInWindow += 1
        continue
      }

      const reminderType = stageFromDaysLeft(daysLeft)
      if (!reminderType) continue

      results.matched += 1

      const key = `${s(profile.employeeId)}::${contractNo}`
      const logs = logMap.get(key) || []

      if (hasReminderLog(logs, reminderType)) {
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

      const created = await LeaveContractReminderLog.create({
        employeeId: s(profile.employeeId),
        contractNo,
        reminderType,
        contractEndDate: endDate,
        sentAt: new Date(),
        sentTo: Array.isArray(notifyResult?.sentTo) ? notifyResult.sentTo : [],
        note: `daysLeft=${daysLeft}`,
      })

      if (!logMap.has(key)) logMap.set(key, [])
      logMap.get(key).unshift(created)

      results.sent += 1
    } catch (err) {
      results.errors += 1
      console.error('leave contract reminder error:', profile?.employeeId, err?.message)
    }
  }

  return results
}

async function getCurrentLeaveContractReminders() {
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
    }
  ).lean()

  const logMap = await getReminderLogMapForProfiles(rows)
  const items = []

  for (const profile of rows) {
    const contract = latestContract(profile.contracts || [])
    const contractNo = num(contract?.contractNo || 0)
    const startDate = s(contract?.startDate || profile?.contractDate)
    const endDate = s(contract?.endDate || profile?.contractEndDate)

    if (!contractNo || !isValidYMD(endDate)) continue

    const daysLeft = diffDaysFromToday(endDate)
    if (!Number.isFinite(daysLeft)) continue
    if (!isVisibleReminderWindow(daysLeft)) continue

    const extra = await enrichProfile(profile)
    const key = `${s(profile.employeeId)}::${contractNo}`
    const logs = logMap.get(key) || []

    const liveStage = stageFromDaysLeft(daysLeft)

    const sentStages = {
      D30: hasReminderLog(logs, 'D30'),
      D14: hasReminderLog(logs, 'D14'),
      D7: hasReminderLog(logs, 'D7'),
      D1: hasReminderLog(logs, 'D1'),
    }

    items.push({
      employeeId: s(profile.employeeId),
      employeeName: s(extra.employee?.name || extra.employee?.fullName || ''),
      name: s(extra.employee?.name || extra.employee?.fullName || ''),
      department: s(extra.employee?.department || ''),
      managerLoginId: s(profile.managerLoginId),
      contractNo,
      startDate,
      endDate,
      daysLeft,

      // current live bucket
      reminderType: liveStage,
      reminderStage: reminderStageDays(liveStage),

      urgencyKey: urgencyKeyFromDaysLeft(daysLeft),
      approvalMode: s(profile.approvalMode),
      employeeLoginId: s(profile.employeeLoginId),

      // one-time send history
      sentStages,
      sentAt30: findLatestLog(logs, 'D30')?.sentAt || null,
      sentAt14: findLatestLog(logs, 'D14')?.sentAt || null,
      sentAt7: findLatestLog(logs, 'D7')?.sentAt || null,
      sentAt1: findLatestLog(logs, 'D1')?.sentAt || null,
    })
  }

  items.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft
    return String(a.employeeId).localeCompare(String(b.employeeId))
  })

  return items
}

module.exports = {
  runLeaveContractReminderJob,
  getCurrentLeaveContractReminders,
}