/* eslint-disable no-console */
// backend/controllers/leave/leaveReport.admin.controller.js
const createError = require('http-errors')
const dayjs = require('dayjs')

const LeaveRequest = require('../../models/leave/LeaveRequest')

/**
 * Parse YYYY-MM-DD safely
 */
function parseYMD(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const d = dayjs(s, 'YYYY-MM-DD', true)
  return d.isValid() ? d : null
}

/**
 * Normalize a leave request row for reporting (tries common field names)
 */
function pickReqFields(r) {
  const type = String(r.type || r.leaveType || r.leaveCode || '').trim().toUpperCase()
  const status = String(r.status || '').trim().toUpperCase()
  const employeeId = String(r.employeeId || r.employeeID || r.empId || r.employee || '').trim()

  const start =
    r.startDate || r.start || r.fromDate || r.from || r.dateFrom || r.requestStartDate || null
  const end =
    r.endDate || r.end || r.toDate || r.to || r.dateTo || r.requestEndDate || null

  const startDate = start ? dayjs(String(start).slice(0, 10)) : null
  const endDate = end ? dayjs(String(end).slice(0, 10)) : null

  const days =
    Number(r.days ?? r.totalDays ?? r.deductDays ?? r.duration ?? 0) || 0

  const department = String(r.department || r.dept || '').trim()
  const managerEmployeeId = String(r.managerEmployeeId || r.managerId || '').trim()

  return {
    _id: String(r._id),
    employeeId,
    type,
    status,
    startDate: startDate?.isValid() ? startDate.format('YYYY-MM-DD') : '',
    endDate: endDate?.isValid() ? endDate.format('YYYY-MM-DD') : '',
    days,
    department,
    managerEmployeeId,
  }
}

/**
 * GET /admin/leave/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&status=APPROVED
 *
 * Returns:
 * - totals by type
 * - totals by status
 * - totals by department (optional if present)
 * - grand totals
 */
exports.getLeaveReportSummary = async (req, res) => {
  const fromQ = parseYMD(req.query.from)
  const toQ = parseYMD(req.query.to)
  const statusQ = String(req.query.status || 'APPROVED').trim().toUpperCase()

  // default: current month
  const from = fromQ || dayjs().startOf('month')
  const to = toQ || dayjs().endOf('month')

  if (!from.isValid() || !to.isValid()) throw createError(400, 'Invalid from/to date.')
  if (to.isBefore(from)) throw createError(400, '"to" must be after "from".')

  // Match by date overlap (start <= to AND end >= from)
  // We try both (startDate/endDate) and fall back gracefully by not filtering if fields missing.
  const match = {
    $and: [
      { status: statusQ },
      {
        $or: [
          // Common schema: startDate/endDate
          {
            $and: [
              { startDate: { $lte: to.format('YYYY-MM-DD') } },
              { endDate: { $gte: from.format('YYYY-MM-DD') } },
            ],
          },
          // Alternate: fromDate/toDate
          {
            $and: [
              { fromDate: { $lte: to.format('YYYY-MM-DD') } },
              { toDate: { $gte: from.format('YYYY-MM-DD') } },
            ],
          },
          // If schema differs, still include (won’t break; just less filtering)
          {},
        ],
      },
    ],
  }

  // Pull only needed fields
  const rows = await LeaveRequest.find(match)
    .select(
      '_id employeeId employeeID empId employee type leaveType leaveCode status startDate endDate fromDate toDate days totalDays deductDays duration department dept managerEmployeeId managerId createdAt'
    )
    .lean()

  const normalized = rows.map(pickReqFields).filter(r => r.employeeId && r.type)

  const byType = {}
  const byStatus = {}
  const byDept = {}

  let totalRequests = 0
  let totalDays = 0

  for (const r of normalized) {
    totalRequests += 1
    totalDays += r.days

    byType[r.type] = byType[r.type] || { type: r.type, requests: 0, days: 0 }
    byType[r.type].requests += 1
    byType[r.type].days += r.days

    byStatus[r.status] = byStatus[r.status] || { status: r.status, requests: 0, days: 0 }
    byStatus[r.status].requests += 1
    byStatus[r.status].days += r.days

    const deptKey = r.department || 'Unknown'
    byDept[deptKey] = byDept[deptKey] || { department: deptKey, requests: 0, days: 0 }
    byDept[deptKey].requests += 1
    byDept[deptKey].days += r.days
  }

  // Sort helpers
  const sortDaysDesc = (a, b) => (b.days || 0) - (a.days || 0)

  res.json({
    range: { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') },
    status: statusQ,
    totals: {
      requests: totalRequests,
      days: Number(totalDays.toFixed(2)),
    },
    byType: Object.values(byType).sort(sortDaysDesc),
    byStatus: Object.values(byStatus).sort(sortDaysDesc),
    byDepartment: Object.values(byDept).sort(sortDaysDesc),
    sample: normalized.slice(0, 50), // keep small (debugging friendly)
  })
}
