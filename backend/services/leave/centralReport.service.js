/* eslint-disable no-console */

const LeaveRequest = require('../../models/leave/LeaveRequest')
const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const ExpatForgetScanRequest = require('../../models/forgetScan/ExpatForgetScanRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

function contains(a, b) {
  return s(a).toLowerCase().includes(s(b).toLowerCase())
}

/**
 * ✅ Unified “stage” derived from status
 */
function stageFromStatus(status) {
  const st = up(status)
  if (st === 'PENDING_MANAGER') return 'MANAGER'
  if (st === 'PENDING_GM') return 'GM'
  if (st === 'PENDING_COO') return 'COO'
  if (st === 'APPROVED') return 'FINAL'
  if (st === 'REJECTED') return 'FINAL'
  if (st === 'CANCELLED') return 'FINAL'
  return 'UNKNOWN'
}

/**
 * ✅ Date range filter helper:
 * We match if rowRange overlaps [from..to]
 */
function overlapRange(rowFrom, rowTo, from, to) {
  const a = s(rowFrom)
  const b = s(rowTo || rowFrom)
  const f = s(from)
  const t = s(to)
  if (!isValidYMD(a)) return false
  if (!isValidYMD(b)) return false

  // no filter => keep
  if (!f && !t) return true

  // if only from
  if (f && !t) return b >= f
  // if only to
  if (!f && t) return a <= t

  // overlap:
  // rowTo >= from AND rowFrom <= to
  return b >= f && a <= t
}

/**
 * ✅ Fetch employee directory info once (fast join in memory)
 */
async function attachEmployeeInfo(rows) {
  const ids = [...new Set((rows || []).map((r) => s(r.employeeId)).filter(Boolean))]
  if (!ids.length) return rows

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [s(e.employeeId), e]))

  return (rows || []).map((r) => {
    const emp = map.get(s(r.employeeId))
    return {
      ...r,
      employeeName: r.employeeName || emp?.name || '',
      department: r.department || emp?.department || '',
    }
  })
}

/**
 * ✅ Map LeaveRequest -> central row
 */
function mapLeave(doc) {
  const id = s(doc?._id)
  const from = s(doc?.startDate)
  const to = s(doc?.endDate || doc?.startDate)

  return {
    module: 'LEAVE',
    requestId: id,

    employeeId: s(doc?.employeeId),
    employeeName: s(doc?.employeeName),
    department: s(doc?.department),

    approvalMode: up(doc?.approvalMode),
    status: up(doc?.status),
    stage: stageFromStatus(doc?.status),

    dateFrom: from,
    dateTo: to,

    summary: `${up(doc?.leaveTypeCode)} (${Number(doc?.totalDays || 0)} day(s))`,
    reason: s(doc?.reason),

    createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : '',
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : '',

    managerDecisionAt: doc?.managerDecisionAt ? new Date(doc.managerDecisionAt).toISOString() : '',
    gmDecisionAt: doc?.gmDecisionAt ? new Date(doc.gmDecisionAt).toISOString() : '',
    cooDecisionAt: doc?.cooDecisionAt ? new Date(doc.cooDecisionAt).toISOString() : '',
  }
}

/**
 * ✅ Map ForgetScan -> central row
 * (NO attachments)
 */
function mapForget(doc) {
  const id = s(doc?._id)
  const d = s(doc?.forgotDate)

  const types = Array.isArray(doc?.forgotTypes) ? doc.forgotTypes.map(up).join(',') : ''
  const key = up(doc?.forgotKey)

  return {
    module: 'FORGET_SCAN',
    requestId: id,

    employeeId: s(doc?.employeeId),
    employeeName: s(doc?.employeeName),
    department: s(doc?.department),

    approvalMode: up(doc?.approvalMode),
    status: up(doc?.status),
    stage: stageFromStatus(doc?.status),

    dateFrom: d,
    dateTo: d,

    summary: `FORGET ${key || types || ''}`.trim(),
    reason: s(doc?.reason),

    createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : '',
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : '',

    managerDecisionAt: doc?.managerDecisionAt ? new Date(doc.managerDecisionAt).toISOString() : '',
    gmDecisionAt: doc?.gmDecisionAt ? new Date(doc.gmDecisionAt).toISOString() : '',
    cooDecisionAt: doc?.cooDecisionAt ? new Date(doc.cooDecisionAt).toISOString() : '',
  }
}

/**
 * ✅ Map SwapDay -> central row
 * (NO attachments per your latest rule)
 */
function mapSwap(doc) {
  const id = s(doc?._id)
  const rs = s(doc?.requestStartDate)
  const re = s(doc?.requestEndDate)
  const os = s(doc?.offStartDate)
  const oe = s(doc?.offEndDate)

  const w = Number(doc?.requestTotalDays || 0)
  const off = Number(doc?.offTotalDays || 0)

  return {
    module: 'SWAP_DAY',
    requestId: id,

    employeeId: s(doc?.employeeId),
    employeeName: s(doc?.employeeName),
    department: s(doc?.department),

    approvalMode: up(doc?.approvalMode),
    status: up(doc?.status),
    stage: stageFromStatus(doc?.status),

    dateFrom: rs,
    dateTo: re,

    summary: `WORK ${rs}${re && re !== rs ? `→${re}` : ''} | OFF ${os}${oe && oe !== os ? `→${oe}` : ''} (${w}/${off})`,
    reason: s(doc?.reason),

    createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : '',
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : '',

    managerDecisionAt: doc?.managerDecisionAt ? new Date(doc.managerDecisionAt).toISOString() : '',
    gmDecisionAt: doc?.gmDecisionAt ? new Date(doc.gmDecisionAt).toISOString() : '',
    cooDecisionAt: doc?.cooDecisionAt ? new Date(doc.cooDecisionAt).toISOString() : '',
  }
}

/**
 * ✅ Main service: returns { rows, total }
 * - Reads 3 collections
 * - Normalizes to same row shape
 * - Filters in memory (simple + predictable)
 * - Sort newest first (createdAt)
 * - Paginate (skip/limit)
 */
exports.getCentralReport = async ({
  search = '',
  module = 'ALL',
  status = 'ALL',
  approvalMode = 'ALL',
  from = '',
  to = '',
  limit = 50,
  skip = 0,
}) => {
  // 1) Query each module (lean for speed)
  // NOTE: We keep DB query broad and do combined filtering after mapping.
  // This is easiest to keep “one behavior” across all modules.

  const wantLeave = module === 'ALL' || module === 'LEAVE'
  const wantForget = module === 'ALL' || module === 'FORGET_SCAN'
  const wantSwap = module === 'ALL' || module === 'SWAP_DAY'

  const [leaveRows, forgetRows, swapRows] = await Promise.all([
    wantLeave ? LeaveRequest.find({}).sort({ createdAt: -1 }).lean() : Promise.resolve([]),
    wantForget ? ExpatForgetScanRequest.find({}).sort({ createdAt: -1 }).lean() : Promise.resolve([]),
    wantSwap ? SwapWorkingDayRequest.find({}).sort({ createdAt: -1 }).lean() : Promise.resolve([]),
  ])

  // 2) Attach employee info (name/department) for each module
  const [leaveWithEmp, forgetWithEmp, swapWithEmp] = await Promise.all([
    attachEmployeeInfo(leaveRows),
    attachEmployeeInfo(forgetRows),
    attachEmployeeInfo(swapRows),
  ])

  // 3) Map to unified rows
  let rows = [
    ...leaveWithEmp.map(mapLeave),
    ...forgetWithEmp.map(mapForget),
    ...swapWithEmp.map(mapSwap),
  ]

  // 4) Apply filters (in one place)
  const q = s(search)
  rows = rows.filter((r) => {
    // status
    if (status !== 'ALL' && up(r.status) !== status) return false

    // mode
    if (approvalMode !== 'ALL' && up(r.approvalMode) !== approvalMode) return false

    // date range overlap
    if (!overlapRange(r.dateFrom, r.dateTo, from, to)) return false

    // search: employeeId / name / department / summary
    if (q) {
      const ok =
        contains(r.employeeId, q) ||
        contains(r.employeeName, q) ||
        contains(r.department, q) ||
        contains(r.summary, q)

      if (!ok) return false
    }

    return true
  })

  // 5) Sort newest first using createdAt (ISO string)
  rows.sort((a, b) => s(b.createdAt).localeCompare(s(a.createdAt)))

  // 6) Paginate
  const total = rows.length
  const paged = rows.slice(skip, skip + limit)

  return {
    total,
    rows: paged,
  }
}