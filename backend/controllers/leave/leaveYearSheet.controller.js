// backend/controllers/leave/leaveYearSheet.controller.js
const dayjs = require('dayjs')

const LeaveProfile       = require('../../models/leave/LeaveProfile')
const LeaveRequest       = require('../../models/leave/LeaveRequest')
const LeaveType          = require('../../models/leave/LeaveType')
const EmployeeDirectory  = require('../../models/EmployeeDirectory')

/**
 * Determine current service-year window for an employee,
 * based on joinDate.
 *
 * - service year = from joinDate (month/day) this year
 *                  until the day before next year’s anniversary
 * - if today is before this-year-anniversary → use last year’s anniversary
 */
function getServiceYearRange(joinDateRaw, nowRaw = new Date()) {
  const today = dayjs(nowRaw)

  let join = joinDateRaw ? dayjs(joinDateRaw) : null
  if (!join || !join.isValid()) {
    // fallback: calendar year
    const start = today.startOf('year')
    const end   = start.add(1, 'year').subtract(1, 'day')
    return { start, end }
  }

  // anniversary with this year's year value
  let annivThisYear = join.year(today.year())

  // if today is before this-year-anniversary → use previous year
  if (today.isBefore(annivThisYear, 'day')) {
    annivThisYear = annivThisYear.subtract(1, 'year')
  }

  const start = annivThisYear.startOf('day')
  const end   = start.add(1, 'year').subtract(1, 'day').endOf('day')

  return { start, end }
}

/** helper: number of days inclusive between two dates */
function calcDays(startDate, endDate) {
  if (!startDate || !endDate) return 0
  const s = dayjs(startDate)
  const e = dayjs(endDate)
  if (!s.isValid() || !e.isValid()) return 0
  return e.diff(s, 'day') + 1
}

/**
 * GET /api/admin/leave/profiles/:employeeId/year-sheet
 *
 * Query: optional ?asOf=YYYY-MM-DD (default: today)
 *
 * Roles: LEAVE_ADMIN, LEAVE_MANAGER, LEAVE_GM, ADMIN
 *
 * Returns:
 * {
 *   employee: { employeeId, name, department, ... },
 *   period: { startDate, endDate },
 *   totals: [
 *     { code, name, entitlement, usedApproved, remaining }
 *   ],
 *   requests: [ ...raw LeaveRequest docs... ]
 * }
 */
exports.getEmployeeYearSheet = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    const { asOf } = req.query

    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId required' })
    }

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) {
      return res.status(404).json({ message: 'Employee not found' })
    }

    const profile = await LeaveProfile.findOne({ employeeId }).lean()
    if (!profile) {
      return res.status(404).json({ message: 'Leave profile not found' })
    }

    // service-year window (dynamic, based on joinDate)
    const { start, end } = getServiceYearRange(profile.joinDate, asOf || new Date())

    // load all leave types for rule info
    const types = await LeaveType.find({ isActive: true }).lean()
    const typeMap = new Map(types.map(t => [t.code, t]))

    // prepare totals for each type
    const totals = {}
    for (const t of types) {
      totals[t.code] = {
        code: t.code,
        name: t.name,
        entitlement: t.yearlyEntitlement ?? 0,
        usedApproved: 0,
        remaining: t.yearlyEntitlement ?? 0,
      }
    }

    // pull requests in this service year window
    const reqDocs = await LeaveRequest.find({
      employeeId,
      startDate: { $gte: start.toDate(), $lte: end.toDate() },
    })
      .sort({ startDate: 1 })
      .lean()

    for (const r of reqDocs) {
      const code = r.leaveTypeCode
      const days = r.totalDays || calcDays(r.startDate, r.endDate)
      const tTotal = totals[code]
      if (!tTotal) continue

      // count only APPROVED into "usedApproved"
      if (r.status === 'APPROVED') {
        tTotal.usedApproved += days
      }
    }

    // recompute remaining with allowNegative flag
    for (const [code, t] of Object.entries(totals)) {
      const lt = typeMap.get(code)
      const allowNeg = lt?.allowNegative || false
      let remaining = (t.entitlement ?? 0) - (t.usedApproved ?? 0)
      if (!allowNeg && remaining < 0) remaining = 0
      t.remaining = remaining
    }

    res.json({
      employee: {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || emp.departmentName || '',
        contactNumber: emp.contactNumber,
      },
      period: {
        startDate: start.format('YYYY-MM-DD'),
        endDate:   end.format('YYYY-MM-DD'),
      },
      totals: Object.values(totals).sort((a, b) => a.code.localeCompare(b.code)),
      requests: reqDocs,
    })
  } catch (err) {
    next(err)
  }
}
