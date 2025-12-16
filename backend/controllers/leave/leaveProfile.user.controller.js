// backend/controllers/leave/leaveProfile.user.controller.js
const LeaveProfile      = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

exports.getMyProfile = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const role    = String(req.user?.role || '').trim().toUpperCase()

    const canViewOther = ['LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'].includes(role)

    // ✅ allow manager/GM/admin to pass employeeId as query but still same endpoint: /my
    const requestedEmployeeId = canViewOther
      ? String(req.query?.employeeId || '').trim()
      : ''

    const employeeId = String(
      requestedEmployeeId ||
      req.user?.employeeId ||
      loginId ||
      ''
    ).trim()

    if (!employeeId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const profile = await LeaveProfile.findOne({
      employeeId,
      isActive: true
    }).lean()

    if (!profile) {
      return res.status(404).json({
        message:
          'Leave profile is not configured for this employee. Please contact HR/Admin.'
      })
    }

    // ✅ authorization: manager/GM can only view their own employees
    if (requestedEmployeeId) {
      if (role === 'LEAVE_MANAGER' && String(profile.managerLoginId || '') !== loginId) {
        return res.status(403).json({ message: 'Not allowed to view this employee profile' })
      }
      if (role === 'LEAVE_GM' && String(profile.gmLoginId || '') !== loginId) {
        return res.status(403).json({ message: 'Not allowed to view this employee profile' })
      }
      // LEAVE_ADMIN / ADMIN are allowed without extra checks
    }

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()

    res.json({
      employeeId: profile.employeeId,
      name: emp?.name || emp?.fullName || '',
      department: emp?.departmentName || emp?.department || '',
      joinDate: profile.joinDate || null,
      contractDate: profile.contractDate || null,
      balances: Array.isArray(profile.balances) ? profile.balances : []
    })
  } catch (err) {
    next(err)
  }
}


// ✅ NEW: list profiles that this manager/GM can review (read-only)
exports.listManagedProfiles = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const role    = String(req.user?.role || '').trim().toUpperCase()

    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    // Manager sees only their employees, GM sees only their employees
    let filter = { isActive: true }

    if (role === 'LEAVE_MANAGER') filter.managerLoginId = loginId
    else if (role === 'LEAVE_GM') filter.gmLoginId = loginId
    else if (role === 'LEAVE_ADMIN' || role === 'ADMIN') {
      // admin can see all (optional)
    } else {
      return res.status(403).json({ message: 'Not allowed' })
    }

    const profiles = await LeaveProfile.find(filter).lean()

    const employeeIds = profiles.map(p => String(p.employeeId))
    const employees = await EmployeeDirectory.find({
      employeeId: { $in: employeeIds }
    }).lean()

    const empMap = new Map(employees.map(e => [String(e.employeeId), e]))

    const rows = profiles.map(p => {
      const emp = empMap.get(String(p.employeeId)) || {}
      return {
        employeeId: p.employeeId,
        name: emp?.name || emp?.fullName || '',
        department: emp?.departmentName || emp?.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        balances: Array.isArray(p.balances) ? p.balances : []
      }
    })

    res.json(rows)
  } catch (err) {
    next(err)
  }
}
