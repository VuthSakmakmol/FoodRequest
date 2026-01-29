//backend/services/leave/leaveProfile.service.js
function s(v) {
  return String(v ?? '').trim()
}

function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '').trim())
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

function addDaysYMD(ymd, deltaDays) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addYearsYMD(ymd, years) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function computeContractEndDate(contractDateYMD) {
  if (!isValidYMD(contractDateYMD)) return ''
  // 1 year - 1 day
  return addDaysYMD(addYearsYMD(contractDateYMD, 1), -1)
}

// ✅ Only 2 modes forever
function normalizeApprovalMode(v) {
  const x = String(v ?? '').trim().toUpperCase()
  if (x === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (x === 'MANAGER_GM') return 'MANAGER_AND_GM'
  if (x === 'GM_OR_COO') return 'GM_AND_COO'
  if (x === 'GM_COO') return 'GM_AND_COO'
  if (x === 'MANAGER_AND_GM') return x
  if (x === 'GM_AND_COO') return x
  return ''
}

/**
 * Default balances when creating a profile.
 * You can later plug in your real accrual logic here.
 */
function buildDefaultBalances({ joinDate, alCarry = 0 }) {
  return [
    { leaveTypeCode: 'AL', yearlyEntitlement: 0, used: 0, remaining: Number(alCarry || 0) },
    { leaveTypeCode: 'SP', yearlyEntitlement: 7, used: 0, remaining: 7 },
    { leaveTypeCode: 'MC', yearlyEntitlement: 90, used: 0, remaining: 90 },
    { leaveTypeCode: 'MA', yearlyEntitlement: 90, used: 0, remaining: 90 },
    { leaveTypeCode: 'UL', yearlyEntitlement: 0, used: 0, remaining: 0 },
  ]
}

const TYPE_ORDER = ['AL', 'SP', 'MC', 'MA', 'UL']

function ensureBalancesOrder(arr) {
  const rows = Array.isArray(arr) ? arr : []
  const map = new Map()
  for (const r of rows) {
    const code = String(r?.leaveTypeCode || '').toUpperCase().trim()
    if (!code) continue
    map.set(code, {
      leaveTypeCode: code,
      yearlyEntitlement: Number(r?.yearlyEntitlement || 0),
      used: Number(r?.used || 0),
      remaining: Number(r?.remaining || 0),
    })
  }
  // force order + ensure all exist
  const out = []
  for (const code of TYPE_ORDER) {
    out.push(map.get(code) || { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
  }
  // keep any custom types after
  for (const [code, v] of map.entries()) {
    if (!TYPE_ORDER.includes(code)) out.push(v)
  }
  return out
}

function nextContractNo(contracts) {
  const rows = Array.isArray(contracts) ? contracts : []
  const max = rows.reduce((m, r) => Math.max(m, Number(r?.contractNo || 0)), 0)
  return max + 1
}

function toProfileDTO(p) {
  if (!p) return null
  return {
    employeeId: p.employeeId,
    employeeLoginId: p.employeeLoginId,
    managerLoginId: p.managerLoginId,
    gmLoginId: p.gmLoginId,
    cooLoginId: p.cooLoginId,
    approvalMode: p.approvalMode,
    name: p.name,
    department: p.department,
    joinDate: p.joinDate,
    contractDate: p.contractDate,
    contractEndDate: p.contractEndDate,
    isActive: p.isActive,
    balances: p.balances || [],
    balancesAsOf: p.balancesAsOf,
    contracts: p.contracts || [],
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
  }
}

module.exports = {
  s,
  isValidYMD,
  computeContractEndDate,
  normalizeApprovalMode,
  buildDefaultBalances,
  ensureBalancesOrder,
  nextContractNo,
  toProfileDTO,
  addDaysYMD,
  addYearsYMD,
}
