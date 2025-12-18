/* eslint-disable no-console */
// backend/controllers/leave/leaveTypes.controller.js
const LeaveType = require('../../models/leave/LeaveType')

exports.listAdminLeaveTypes = async (_req, res) => {
  try {
    const rows = await LeaveType.find({})
      .sort({ order: 1, code: 1 })
      .select('code name description yearlyEntitlement requiresBalance isActive order isSystem yearlyLimit fixedDurationDays accrualPerMonth allowNegative')
      .lean()

    return res.json(Array.isArray(rows) ? rows : [])
  } catch (err) {
    console.error('listAdminLeaveTypes error', err)
    return res.status(500).json({ message: 'Failed to load leave types' })
  }
}
