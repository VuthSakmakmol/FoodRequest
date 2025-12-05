// backend/controllers/leave/leaveProfile.admin.controller.js
const LeaveProfile        = require('../../models/leave/LeaveProfile')
const EmployeeDirectory   = require('../../models/EmployeeDirectory')
const LeaveType           = require('../../models/leave/LeaveType')
const LeaveRequest        = require('../../models/leave/LeaveRequest')

/** helper: safe date parse from "YYYY-MM-DD" */
function parseDate(d) {
  if (!d) return null
  const v = new Date(d)
  return Number.isNaN(v.getTime()) ? null : v
}

/** normalize balances array from request body */
function normalizeBalances(balances) {
  if (!Array.isArray(balances)) return []

  return balances
    .map(b => ({
      leaveTypeCode: String(b.leaveTypeCode || '').trim().toUpperCase(),
      yearlyEntitlement: Number(b.yearlyEntitlement ?? 0),
      used: Number(b.used ?? 0),
      remaining: Number(b.remaining ?? 0),
    }))
    .filter(b => b.leaveTypeCode) // keep only if code not empty
}

/** small utility: format Date → YYYY-MM-DD */
function toYMD(d) {
  if (!d) return ''
  const v = new Date(d)
  if (Number.isNaN(v.getTime())) return ''
  const y = v.getFullYear()
  const m = String(v.getMonth() + 1).padStart(2, '0')
  const day = String(v.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** inclusive days between two dates */
function diffDaysInclusive(a, b) {
  const d1 = new Date(a)
  const d2 = new Date(b)
  const ms = d2.setHours(0, 0, 0, 0) - d1.setHours(0, 0, 0, 0)
  return ms >= 0 ? Math.floor(ms / 86400000) + 1 : 0
}

/** months difference (floor), used for AL accrual */
function diffMonthsFloor(from, to) {
  const a = new Date(from)
  const b = new Date(to)
  let months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months -= 1
  return months < 0 ? 0 : months
}

/** find current service year (join-date based) */
function computeServiceYear(joinDate, now = new Date()) {
  if (!joinDate) {
    // fall back to calendar year
    const start = new Date(now.getFullYear(), 0, 1)
    const end   = new Date(now.getFullYear(), 11, 31)
    return { start, end }
  }

  const jd = new Date(joinDate)
  if (Number.isNaN(jd.getTime())) {
    const start = new Date(now.getFullYear(), 0, 1)
    const end   = new Date(now.getFullYear(), 11, 31)
    return { start, end }
  }

  let year  = now.getFullYear()
  let start = new Date(year, jd.getMonth(), jd.getDate())

  // if next anniversary is in the future, go back one year
  if (start > now) {
    year -= 1
    start = new Date(year, jd.getMonth(), jd.getDate())
  }

  const end = new Date(start)
  end.setFullYear(start.getFullYear() + 1)
  end.setDate(end.getDate() - 1) // inclusive

  return { start, end }
}

/**
 * Compute entitlement for a leave type in current service year.
 * Business rules based on your earlier spec:
 *  - AL: accrualPerMonth (1.5) from join date → now (max 12 months), cap at yearlyEntitlement
 *  - SP: yearlyLimit (7)
 *  - MC/MA: yearlyEntitlement (60 / 90)
 *  - UL: unlimited (entitlement 0, remaining not enforced)
 */
function computeEntitlementForType(typeDoc, profile, servicePeriod) {
  const code = typeDoc.code
  const perYear = Number(typeDoc.yearlyEntitlement || 0)
  const perMonth = Number(typeDoc.accrualPerMonth || 0)
  const yearlyLimit = Number(typeDoc.yearlyLimit || 0)

  const now   = new Date()
  const start = servicePeriod.start
  const end   = servicePeriod.end

  // We only accrue up to either "now" or service-year end, whichever is earlier
  const effectiveEnd = now > end ? end : now

  if (code === 'AL') {
    const join = profile.joinDate ? new Date(profile.joinDate) : start
    const accrualStart = join > start ? join : start
    if (effectiveEnd <= accrualStart) return 0

    let months = diffMonthsFloor(accrualStart, effectiveEnd)
    if (months > 12) months = 12

    let entitlement = months * perMonth
    if (perYear && entitlement > perYear) entitlement = perYear
    return entitlement
  }

  if (code === 'SP') {
    return yearlyLimit || perYear || 0
  }

  if (code === 'UL') {
    // unpaid – no limit enforcement
    return 0
  }

  // default: fixed yearly entitlement (MC, MA, etc.)
  return perYear
}

/* ─────────────────────────────
 *  BASIC ADMIN PROFILE APIs
 * ───────────────────────────── */

/**
 * GET /api/admin/leave/profiles
 * List expat leave profiles for admin screen
 */
exports.listProfiles = async (req, res, next) => {
  try {
    const profiles = await LeaveProfile.find({}).lean()

    const employeeIds = profiles.map(p => p.employeeId)
    const employees = await EmployeeDirectory.find({
      employeeId: { $in: employeeIds }
    }).lean()

    const empMap = new Map(employees.map(e => [String(e.employeeId), e]))

    const result = profiles.map(p => {
      const emp = empMap.get(String(p.employeeId)) || {}
      return {
        employeeId: p.employeeId,
        name: emp.name || emp.fullName || '',
        department: emp.departmentName || emp.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        balances: p.balances || [],
      }
    })

    res.json(result)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/admin/leave/profiles/:employeeId
 * Load (or auto-create minimal in memory) profile for one employee
 */
exports.adminGetProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId required' })
    }

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) {
      return res.status(404).json({ message: 'Employee not found' })
    }

    let profile = await LeaveProfile.findOne({ employeeId }).lean()

    if (!profile) {
      // bootstrap minimal profile – manager/gm will be re-wired by seeder or admin later
      profile = {
        employeeId,
        employeeLoginId: employeeId,
        managerLoginId: 'leave_mgr_hr',
        gmLoginId: 'leave_gm',
        joinDate: null,
        contractDate: null,
        balances: [],
        isActive: true,
      }
    }

    // Return employee info + profile together
    res.json({
      employee: {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || emp.departmentName || '',
        contactNumber: emp.contactNumber,
      },
      profile,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * PUT /api/admin/leave/profiles/:employeeId
 * Body: {
 *   joinDate, contractDate,
 *   balances: [{ leaveTypeCode, yearlyEntitlement, used, remaining }]
 * }
 */
exports.adminUpsertProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    const { joinDate, contractDate, balances } = req.body || {}

    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId required' })
    }

    // check employee exists
    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) {
      return res.status(404).json({ message: 'Employee not found' })
    }

    let profile = await LeaveProfile.findOne({ employeeId })

    if (!profile) {
      profile = new LeaveProfile({
        employeeId,
        employeeLoginId: employeeId,
        managerLoginId: 'leave_mgr_hr', // default; can be changed later
        gmLoginId: 'leave_gm',
        isActive: true,
      })
    }

    profile.joinDate    = parseDate(joinDate)
    profile.contractDate = parseDate(contractDate)
    profile.balances    = normalizeBalances(balances)

    await profile.save()

    res.json(profile)
  } catch (err) {
    next(err)
  }
}

// simple alias if you ever import updateProfile
exports.updateProfile = exports.adminUpsertProfile

/* ─────────────────────────────
 *  YEAR SHEET (for AdminExpatYearSheet.vue)
 * ───────────────────────────── */

/**
 * GET /api/admin/leave/profiles/:employeeId/year-sheet
 *
 * Response:
 * {
 *   employee: { ... },
 *   period: { startDate, endDate },
 *   totals: [
 *     { code, name, entitlement, usedApproved, remaining }
 *   ],
 *   requests: [ ... leave requests in this service year ... ]
 * }
 */
exports.getYearSheet = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId required' })
    }

    // 1) Employee + profile
    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) {
      return res.status(404).json({ message: 'Employee not found' })
    }

    let profile = await LeaveProfile.findOne({ employeeId }).lean()
    if (!profile) {
      profile = {
        employeeId,
        employeeLoginId: employeeId,
        joinDate: null,
        managerLoginId: 'leave_mgr_hr',
        gmLoginId: 'leave_gm',
      }
    }

    // 2) Determine service year
    const { start, end } = computeServiceYear(profile.joinDate)
    const period = {
      startDate: toYMD(start),
      endDate:   toYMD(end),
    }

    // 3) Load leave types (AL, SP, MC, MA, UL, etc.)
    const leaveTypes = await LeaveType.find({ isActive: true }).lean()

    // set up totals map
    const totalsMap = new Map()
    for (const t of leaveTypes) {
      totalsMap.set(t.code, {
        code: t.code,
        name: t.name,
        entitlement: 0,
        usedApproved: 0,
        remaining: 0,
      })
    }

    // 4) Load all requests for this employee in this service year
    const reqFilter = {
      startDate: { $gte: start, $lte: end },
      $or: [
        { employeeId: employeeId },
        { employeeLoginId: profile.employeeLoginId || employeeId },
      ],
    }

    const requests = await LeaveRequest.find(reqFilter)
      .sort({ startDate: 1 })
      .lean()

    // 5) Compute used days per type (APPROVED only)
    for (const r of requests) {
      const bucket = totalsMap.get(r.leaveTypeCode)
      if (!bucket) continue

      const days =
        r.totalDays ||
        (r.startDate && r.endDate
          ? diffDaysInclusive(r.startDate, r.endDate)
          : 0)

      if (r.status === 'APPROVED') {
        bucket.usedApproved += days
      }
    }

    // 6) Compute entitlement + remaining
    for (const t of leaveTypes) {
      const bucket = totalsMap.get(t.code)
      if (!bucket) continue

      const entitlement = computeEntitlementForType(t, profile, { start, end })
      bucket.entitlement = entitlement

      if (t.code === 'UL') {
        // unpaid leave – show remaining as 0 (no cap)
        bucket.remaining = 0
      } else {
        const remain = entitlement - bucket.usedApproved
        bucket.remaining = remain > 0 ? remain : 0
      }
    }

    // 7) Build response
    res.json({
      employee: {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || emp.departmentName || '',
        contactNumber: emp.contactNumber || '',
      },
      period,
      totals: Array.from(totalsMap.values()),
      requests,
    })
  } catch (err) {
    next(err)
  }
}
