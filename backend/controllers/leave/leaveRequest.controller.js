// controllers/leave/leaveRequest.controller.js
const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveType = require('../../models/leave/LeaveType')
const LeaveProfile = require('../../models/leave/LeaveProfile')   // 👈 NEW
const { enumerateLocalDates } = require('../../utils/datetime')
const { notifyNewLeaveToManager } = require('../../services/leave/leave.telegram.notify') // 👈 NEW

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'

/**
 * POST /api/leave/requests
 * Body: { leaveTypeCode, startDate, endDate, reason }
 * Creates a new request for the logged-in user (expat).
 */
exports.createMyRequest = async (req, res, next) => {
  try {
    const { leaveTypeCode, startDate, endDate, reason = '' } = req.body || {}

    // loginId from JWT = req.user.id (see signToken in auth.controller.js)
    const requesterLoginId = String(req.user?.id || '').trim()
    if (!requesterLoginId) {
      return res.status(400).json({ message: 'Missing requester identity' })
    }

    // For now we assume: expat loginId == employeeId (employee code)
    const employeeId = requesterLoginId

    if (!leaveTypeCode || !startDate || !endDate) {
      return res.status(400).json({ message: 'leaveTypeCode, startDate, endDate are required' })
    }

    // Ensure leave type exists & active
    const lt = await LeaveType.findOne({
      code: String(leaveTypeCode).trim().toUpperCase(),
      isActive: true,
    }).lean()

    if (!lt) {
      return res.status(400).json({ message: 'Invalid or inactive leave type' })
    }

    // Look up LeaveProfile → who is manager / GM for this expat
    const profile = await LeaveProfile.findOne({
      employeeId,
      isActive: true,
    }).lean()

    if (!profile) {
      return res.status(400).json({
        message: 'Leave profile is not configured for this employee. Please contact HR/admin.',
      })
    }

    const managerLoginId = String(profile.managerLoginId || '').trim()
    const gmLoginId = String(profile.gmLoginId || '').trim()

    if (!managerLoginId || !gmLoginId) {
      return res.status(400).json({
        message: 'Manager/GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    // Calculate days inclusive using helper (no weekend/holiday logic yet)
    const dates = enumerateLocalDates(startDate, endDate, DEFAULT_TZ)
    const totalDays = dates.length

    if (!totalDays || totalDays <= 0) {
      return res.status(400).json({ message: 'Invalid date range' })
    }

    const doc = await LeaveRequest.create({
      employeeId,
      requesterLoginId,
      leaveTypeCode: lt.code,
      startDate,
      endDate,
      totalDays,
      reason,
      status: 'PENDING_MANAGER',
      managerLoginId,
      gmLoginId,
    })

    // 🔔 Telegram DM to manager (if chatId available)
    try {
      await notifyNewLeaveToManager(doc)
    } catch (e) {
      // avoid breaking main flow if Telegram fails
      if (process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ notifyNewLeaveToManager failed:', e?.message)
      }
    }

    // TODO (later): emit socket event as well (io in req.io)

    res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}


/**
 * GET /api/leave/requests/my
 * Returns leave requests for the logged-in user (by employeeId / loginId).
 */
exports.listMyRequests = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const employeeId = loginId

    const docs = await LeaveRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    res.json(docs)
  } catch (err) {
    next(err)
  }
}
