// backend/controllers/leave/leaveProfile.admin.controller.js
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

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

    profile.joinDate = parseDate(joinDate)
    profile.contractDate = parseDate(contractDate)
    profile.balances = normalizeBalances(balances)

    await profile.save()

    res.json(profile)
  } catch (err) {
    next(err)
  }
}

// simple alias if you ever import updateProfile
exports.updateProfile = exports.adminUpsertProfile
