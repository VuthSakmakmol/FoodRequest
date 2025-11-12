// backend/controllers/adminUser.controller.js
const User = require('../models/User')
const CarBooking = require('../models/transportation/CarBooking')
const { toMinutes, overlaps } = require('../utils/time')

const pick = (u) => ({ _id: String(u._id), loginId: u.loginId, name: u.name })
const BUSY_STATUSES = new Set(['ACCEPTED','ON_ROAD','ARRIVING','DELAYED'])

exports.listByRole = async (req, res, next) => {
  try {
    const role = String(req.query.role || '').toUpperCase()
    const ALLOWED = ['ADMIN','EMPLOYEE','DRIVER','MESSENGER']
    if (!ALLOWED.includes(role)) return res.status(400).json({ message: 'Invalid role' })
    const users = await User.find({ role, isActive: true }).sort({ loginId: 1 }).select('loginId name')
    res.json(users.map(pick))
  } catch (e) { next(e) }
}

exports.listDrivers = async (_req, res, next) => {
  try {
    const users = await User.find({ role: 'DRIVER', isActive: true }).sort({ loginId: 1 }).select('loginId name')
    res.json(users.map(pick))
  } catch (e) { next(e) }
}

exports.listMessengers = async (_req, res, next) => {
  try {
    const users = await User.find({ role: 'MESSENGER', isActive: true }).sort({ loginId: 1 }).select('loginId name')
    res.json(users.map(pick))
  } catch (e) { next(e) }
}

/**
 * GET /api/admin/availability/assignees?role=DRIVER|MESSENGER&date=YYYY-MM-DD&start=HH:MM&end=HH:MM
 * Returns { busy: [loginId,...] } for overlapping jobs in BUSY_STATUSES
 */
exports.busyAssignees = async (req, res, next) => {
  try {
    const role = String(req.query.role || '').toUpperCase()
    const { date, start, end } = req.query
    if (!role || !date || !start || !end) return res.status(400).json({ message: 'role, date, start, end are required' })
    if (!['DRIVER','MESSENGER'].includes(role)) return res.status(400).json({ message: 'Invalid role' })

    const [s, e] = [toMinutes(start), toMinutes(end)]
    const idField = role === 'MESSENGER' ? 'assignment.messengerId' : 'assignment.driverId'
    const selectFields = `${idField} timeStart timeEnd`

    const bookings = await CarBooking.find({
      tripDate: date,
      status: { $in: Array.from(BUSY_STATUSES) },
      [idField]: { $ne: '' }
    }).select(selectFields).lean()

    const busy = []
    for (const b of bookings) {
      if (overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))) {
        const val = role === 'MESSENGER' ? b.assignment?.messengerId : b.assignment?.driverId
        if (val) busy.push(val)
      }
    }
    res.json({ role, date, start, end, busy: Array.from(new Set(busy)) })
  } catch (e) { next(e) }
}
