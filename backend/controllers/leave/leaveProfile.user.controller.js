// backend/controllers/leave/leaveProfile.user.controller.js
const LeaveProfile      = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const LeaveRequest      = require('../../models/leave/LeaveRequest')
const { computeBalances } = require('../../utils/leave.rules')

async function getApprovedRequests(employeeId) {
  return LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()
}

exports.getMyProfile = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const role    = String(req.user?.role || '').trim().toUpperCase()

    const canViewOther = ['LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'].includes(role)

    const requestedEmployeeId = canViewOther
      ? String(req.query?.employeeId || '').trim()
      : ''

    const employeeId = String(
      requestedEmployeeId ||
      req.user?.employeeId ||
      loginId ||
      ''
    ).trim()

    if (!employeeId) return res.status(400).json({ message: 'Missing user identity' })

    const profile = await LeaveProfile.findOne({ employeeId, isActive: true }).lean()
    if (!profile) {
      return res.status(404).json({
        message: 'Leave profile is not configured for this employee. Please contact HR/Admin.',
      })
    }

    // Authorization: manager/GM can only view their employees
    if (requestedEmployeeId) {
      if (role === 'LEAVE_MANAGER' && String(profile.managerLoginId || '') !== loginId) {
        return res.status(403).json({ message: 'Not allowed to view this employee profile' })
      }
      if (role === 'LEAVE_GM' && String(profile.gmLoginId || '') !== loginId) {
        return res.status(403).json({ message: 'Not allowed to view this employee profile' })
      }
    }

    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    const approved = await getApprovedRequests(employeeId)
    const snap = computeBalances(profile, approved, new Date())

    res.json({
      employeeId: profile.employeeId,
      name: emp?.name || emp?.fullName || '',
      department: emp?.departmentName || emp?.department || '',
      joinDate: profile.joinDate || null,
      contractDate: profile.contractDate || null,
      alCarry: Number(profile.alCarry || 0),
      balances: snap.balances,
      meta: snap.meta,
    })
  } catch (err) {
    next(err)
  }
}

exports.listManagedProfiles = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const role    = String(req.user?.role || '').trim().toUpperCase()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    let filter = { isActive: true }
    if (role === 'LEAVE_MANAGER') filter.managerLoginId = loginId
    else if (role === 'LEAVE_GM') filter.gmLoginId = loginId
    else if (role === 'LEAVE_ADMIN' || role === 'ADMIN') {
      // admin sees all
    } else {
      return res.status(403).json({ message: 'Not allowed' })
    }

    const profiles = await LeaveProfile.find(filter).lean()
    const employeeIds = profiles.map(p => String(p.employeeId))
    const employees = await EmployeeDirectory.find({ employeeId: { $in: employeeIds } }).lean()
    const empMap = new Map(employees.map(e => [String(e.employeeId), e]))

    const rows = []
    for (const p of profiles) {
      const emp = empMap.get(String(p.employeeId)) || {}
      const approved = await LeaveRequest.find({ employeeId: p.employeeId, status: 'APPROVED' }).lean()
      const snap = computeBalances(p, approved, new Date())

      rows.push({
        employeeId: p.employeeId,
        name: emp?.name || emp?.fullName || '',
        department: emp?.departmentName || emp?.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        alCarry: Number(p.alCarry || 0),
        balances: snap.balances,
      })
    }

    res.json(rows)
  } catch (err) {
    next(err)
  }
}
