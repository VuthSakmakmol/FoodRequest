/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.response.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

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

function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}

function normalizeApprovalMode(v) {
  if (typeof LeaveProfile?.normalizeApprovalMode === 'function') {
    return LeaveProfile.normalizeApprovalMode(v)
  }

  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'MANAGER_ONLY') return 'MANAGER_ONLY'
  if (raw === 'GM_ONLY') return 'GM_ONLY'
  if (raw === 'COO_ONLY') return 'COO_ONLY'
  return 'MANAGER_AND_GM'
}

function normalizeCarryObj(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    AL: num(src.AL),
    SP: num(src.SP),
    MC: num(src.MC),
    MA: num(src.MA),
    UL: num(src.UL),
  }
}

async function attachEmployeeDirectory(profilePlain) {
  const employeeId = s(profilePlain?.employeeId)
  if (!employeeId) return profilePlain

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    {
      employeeId: 1,
      name: 1,
      fullName: 1,
      department: 1,
      position: 1,
      jobTitle: 1,
      title: 1,
      contactNumber: 1,
      telegramChatId: 1,
    }
  ).lean()

  return {
    ...profilePlain,
    name: profilePlain?.name || s(emp?.name || emp?.fullName || ''),
    department: profilePlain?.department || s(emp?.department || ''),
    position:
      profilePlain?.position ||
      s(emp?.position || emp?.jobTitle || emp?.title || ''),
    contactNumber: profilePlain?.contactNumber || s(emp?.contactNumber || ''),
    telegramChatId: profilePlain?.telegramChatId || s(emp?.telegramChatId || ''),
    employee: emp
      ? {
          employeeId: s(emp.employeeId),
          name: s(emp.name || emp.fullName || ''),
          department: s(emp.department || ''),
          position: s(emp.position || emp.jobTitle || emp.title || ''),
          contactNumber: s(emp.contactNumber || ''),
          telegramChatId: s(emp.telegramChatId || ''),
        }
      : null,
  }
}

function latestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null

  const withStart = arr.filter((c) => isValidYMD(c?.startDate))
  if (withStart.length) {
    return withStart.sort((a, b) =>
      String(b.startDate).localeCompare(String(a.startDate))
    )[0]
  }

  return arr
    .slice()
    .sort((a, b) => num(b.contractNo) - num(a.contractNo))[0]
}

function applyCarryToBalancesForDisplay(balances = [], carry = {}) {
  const carryObj = normalizeCarryObj(carry)
  const byCode = new Map(
    Object.entries(carryObj).map(([k, v]) => [up(k), num(v)])
  )

  return (Array.isArray(balances) ? balances : []).map((row) => {
    const code = up(row?.leaveTypeCode)
    const yearlyEntitlement = num(row?.yearlyEntitlement)
    const used = num(row?.used)
    const remaining = num(row?.remaining)

    const carryValue = num(byCode.get(code) ?? 0)
    const extraUsedFromCarry = carryValue < 0 ? Math.abs(carryValue) : 0
    const nextRemaining = remaining + carryValue

    return {
      ...row,
      yearlyEntitlement,
      used: used + extraUsedFromCarry,
      remaining: code === 'UL' ? Math.max(0, nextRemaining) : nextRemaining,
    }
  })
}

function decorateProfileForResponse(profilePlain = {}) {
  const latest = latestContract(profilePlain?.contracts || [])
  const activeCarry = normalizeCarryObj(latest?.carry || {})

  return {
    ...profilePlain,
    approvalMode: normalizeApprovalMode(profilePlain?.approvalMode),
    carry: activeCarry,
    currentContractStartDate: s(profilePlain?.contractDate || latest?.startDate || ''),
    currentContractEndDate: s(profilePlain?.contractEndDate || latest?.endDate || ''),
    balances: applyCarryToBalancesForDisplay(profilePlain?.balances || [], activeCarry),
  }
}

module.exports = {
  attachEmployeeDirectory,
  latestContract,
  normalizeCarryObj,
  applyCarryToBalancesForDisplay,
  decorateProfileForResponse,
  normalizeApprovalMode,
}