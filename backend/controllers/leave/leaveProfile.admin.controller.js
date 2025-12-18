// backend/controllers/leave/leaveProfile.admin.controller.js
const LeaveProfile        = require('../../models/leave/LeaveProfile')
const EmployeeDirectory   = require('../../models/EmployeeDirectory')
const LeaveRequest        = require('../../models/leave/LeaveRequest')
const { SYSTEM_TYPES }    = require('../../config/leaveSystemTypes')
const { computeBalances, computeJoinYearPeriod } = require('../../utils/leave.rules')

function parseDate(d) {
  if (!d) return null
  const v = new Date(d)
  return Number.isNaN(v.getTime()) ? null : v
}

function toYMD(d) {
  if (!d) return ''
  const v = new Date(d)
  if (Number.isNaN(v.getTime())) return ''
  const y = v.getFullYear()
  const m = String(v.getMonth() + 1).padStart(2, '0')
  const day = String(v.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function getApprovedRequests(employeeId) {
  return LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()
}

exports.listProfiles = async (req, res, next) => {
  try {
    const profiles = await LeaveProfile.find({}).lean()

    const employeeIds = profiles.map(p => p.employeeId)
    const employees = await EmployeeDirectory.find({
      employeeId: { $in: employeeIds }
    }).lean()

    const empMap = new Map(employees.map(e => [String(e.employeeId), e]))

    // Compute snapshot balances for each (admin list screen)
    const result = []
    for (const p of profiles) {
      const emp = empMap.get(String(p.employeeId)) || {}
      const approved = await getApprovedRequests(String(p.employeeId))
      const snap = computeBalances(p, approved, new Date())

      result.push({
        employeeId: p.employeeId,
        name: emp.name || emp.fullName || '',
        department: emp.departmentName || emp.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        alCarry: Number(p.alCarry || 0),
        balances: snap.balances, // computed
      })
    }

    res.json(result)
  } catch (err) {
    next(err)
  }
}

exports.adminGetProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' })

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) return res.status(404).json({ message: 'Employee not found' })

    let profile = await LeaveProfile.findOne({ employeeId }).lean()

    if (!profile) {
      profile = {
        employeeId,
        employeeLoginId: employeeId,
        managerLoginId: 'leave_mgr_hr',
        gmLoginId: 'leave_gm',
        joinDate: null,
        contractDate: null,
        alCarry: 0,
        isActive: true,
      }
    }

    const approved = await getApprovedRequests(employeeId)
    const snap = computeBalances(profile, approved, new Date())

    res.json({
      employee: {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || emp.departmentName || '',
        contactNumber: emp.contactNumber,
      },
      profile: {
        ...profile,
        balances: snap.balances, // computed
      },
      systemLeaveTypes: SYSTEM_TYPES, // useful for UI dropdown display
    })
  } catch (err) {
    next(err)
  }
}

/**
 * PUT /api/admin/leave/profiles/:employeeId
 * Body: { joinDate, contractDate, managerLoginId, gmLoginId, isActive, alCarry? }
 *
 * ✅ balances are NOT editable by admin anymore
 */
exports.adminUpsertProfile = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    const { joinDate, contractDate, managerLoginId, gmLoginId, isActive, alCarry } = req.body || {}

    if (!employeeId) return res.status(400).json({ message: 'employeeId required' })

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) return res.status(404).json({ message: 'Employee not found' })

    let profile = await LeaveProfile.findOne({ employeeId })

    if (!profile) {
      profile = new LeaveProfile({
        employeeId,
        employeeLoginId: employeeId,
        managerLoginId: managerLoginId || 'leave_mgr_hr',
        gmLoginId: gmLoginId || 'leave_gm',
        isActive: true,
        alCarry: 0,
      })
    }

    if (typeof managerLoginId === 'string') profile.managerLoginId = managerLoginId.trim()
    if (typeof gmLoginId === 'string') profile.gmLoginId = gmLoginId.trim()

    if (typeof isActive === 'boolean') profile.isActive = isActive

    if (joinDate !== undefined) profile.joinDate = parseDate(joinDate)
    if (contractDate !== undefined) profile.contractDate = parseDate(contractDate)

    // optional: allow admin to correct carry debt if needed
    if (alCarry !== undefined) profile.alCarry = Number(alCarry || 0)

    await profile.save()

    // Return with computed snapshot
    const approved = await getApprovedRequests(employeeId)
    const snap = computeBalances(profile.toObject(), approved, new Date())

    res.json({
      ...profile.toObject(),
      balances: snap.balances,
    })
  } catch (err) {
    next(err)
  }
}

exports.updateProfile = exports.adminUpsertProfile

/**
 * GET /api/admin/leave/profiles/:employeeId/year-sheet
 */
exports.getYearSheet = async (req, res, next) => {
  try {
    const { employeeId } = req.params
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' })

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    if (!emp) return res.status(404).json({ message: 'Employee not found' })

    let profile = await LeaveProfile.findOne({ employeeId }).lean()
    if (!profile) {
      profile = {
        employeeId,
        employeeLoginId: employeeId,
        joinDate: null,
        contractDate: null,
        alCarry: 0,
        managerLoginId: 'leave_mgr_hr',
        gmLoginId: 'leave_gm',
      }
    }

    // Join-year period (for SP + MC renew window)
    const { start, end } = computeJoinYearPeriod(profile.joinDate, new Date())
    const period = { startDate: toYMD(start), endDate: toYMD(end) }

    // Pull ALL requests in join-year for display
    const requests = await LeaveRequest.find({
      employeeId,
      startDate: { $gte: period.startDate, $lte: period.endDate },
    }).sort({ startDate: 1 }).lean()

    const approved = (requests || []).filter(r => r.status === 'APPROVED')
    const snap = computeBalances(profile, approved, new Date())

    res.json({
      employee: {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || emp.departmentName || '',
        contactNumber: emp.contactNumber || '',
      },
      period,
      totals: snap.balances, // already includes entitlement/used/remaining
      requests,
      meta: snap.meta,
      systemLeaveTypes: SYSTEM_TYPES,
    })
  } catch (err) {
    next(err)
  }
}
