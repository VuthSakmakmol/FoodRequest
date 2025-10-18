// backend/controllers/carBooking.controller.js
const createError = require('http-errors')
const CarBooking = require('../../models/transportation/CarBooking')

let User = null
try { User = require('../../models/User') } catch { User = null }

let Employee = null
try { Employee = require('../models/Employee') } catch {
  try { Employee = require('../../models/EmployeeDirectory') } catch { Employee = null }
}

const { toMinutes, overlaps, isValidDate } = require('../../utils/time')
const { notify } = require('../../services/transport.telegram.notify')   // Telegram notify entrypoint

const MAX_CAR  = 3
const MAX_MSGR = 1

const FORWARD = {
  PENDING:   new Set(['ACCEPTED','CANCELLED']),
  ACCEPTED:  new Set(['ON_ROAD','DELAYED','CANCELLED']),
  ON_ROAD:   new Set(['ARRIVING','DELAYED','CANCELLED']),
  ARRIVING:  new Set(['COMPLETED','DELAYED','CANCELLED']),
  DELAYED:   new Set(['ON_ROAD','ARRIVING','CANCELLED']),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
}

/* ---------- helpers ---------- */
function parsePayload(req) {
  if (req.file) {
    if (!req.body?.data) throw createError(400, 'Missing "data" field in multipart form.')
    try { return JSON.parse(req.body.data) } catch { throw createError(400, 'Invalid JSON in "data".') }
  }
  return req.body || {}
}

function pickIdentityFrom(req) {
  const loginId =
    req.user?.loginId ||
    req.headers['x-login-id'] ||
    req.headers['x-user-id'] ||
    req.query.driverId ||
    req.session?.user?.loginId ||
    req.cookies?.loginId ||
    ''
  const role =
    (req.user?.role || req.headers['x-role'] || req.query.role ||
     req.session?.user?.role || req.cookies?.role || '')
      .toString().toUpperCase()

  return { loginId: String(loginId || ''), role }
}

/* ---------- public ---------- */
async function checkAvailability(req, res, next) {
  try {
    const { date, start, end, category } = req.query
    if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
    if (!start || !end) throw createError(400, 'start and end are required (HH:MM).')
    if (!['Car','Messenger'].includes(category)) throw createError(400, 'Invalid category.')
    const s = toMinutes(start), e = toMinutes(end)
    if (e <= s) throw createError(400, 'End must be after Start.')

    const docs = await CarBooking.find({ tripDate: date, category, status: { $nin: ['CANCELLED'] } }).lean()
    const busy = docs.filter(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))).length
    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    res.json({ date, start, end, category, busy, max, available: Math.max(0, max - busy) })
  } catch (err) { next(err) }
}

async function createBooking(req, res, next) {
  try {
    const payload = parsePayload(req)
    const { employeeId, category, tripDate, timeStart, timeEnd, passengers, customerContact, stops, purpose, notes } = payload

    if (!employeeId) throw createError(400, 'employeeId is required.')
    if (!['Car','Messenger'].includes(category)) throw createError(400, 'Invalid category.')
    if (!isValidDate(tripDate)) throw createError(400, 'Invalid tripDate (YYYY-MM-DD).')
    if (!timeStart || !timeEnd) throw createError(400, 'timeStart and timeEnd are required (HH:MM).')

    const s = toMinutes(timeStart), e = toMinutes(timeEnd)
    if (e <= s) throw createError(400, 'End must be after Start.')

    if (!Array.isArray(stops) || stops.length === 0) throw createError(400, 'At least one destination (stop) is required.')
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i]
      if (!st?.destination) throw createError(400, `Stop ${i+1}: destination is required.`)
      if (st.destination === 'Other' && !st.destinationOther) throw createError(400, `Stop ${i+1}: destinationOther is required for "Other".`)
    }

    const hasAirport = stops.some(st => st.destination === 'Airport')
    let ticketUrl = ''
    if (hasAirport) {
      if (!req.file) throw createError(400, 'Airplane ticket is required for Airport destination.')
      ticketUrl = `/uploads/${req.file.filename}`
    } else if (req.file) {
      ticketUrl = `/uploads/${req.file.filename}`
    }

    const active = await CarBooking.find({ tripDate, category, status: { $nin: ['CANCELLED'] } }).lean()
    const overlapping = active.filter(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))).length
    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    if (overlapping >= max) {
      return res.status(409).json({ message: `No ${category.toLowerCase()} available for ${tripDate} ${timeStart}-${timeEnd}.` })
    }

    let employeeSnapshot = { employeeId, name:'', department:'', contactNumber:'' }
    if (Employee) {
      const emp = await Employee.findOne({ employeeId }).lean()
      if (emp) employeeSnapshot = {
        employeeId: emp.employeeId, name: emp.name || '', department: emp.department || '', contactNumber: emp.contactNumber || ''
      }
    }

    const doc = await CarBooking.create({
      employeeId,
      employee: employeeSnapshot,
      category, tripDate, timeStart, timeEnd,
      passengers: Number(passengers || 1),
      customerContact: customerContact || '',
      stops, purpose: purpose || '', notes: notes || '',
      ticketUrl
    })

    // SOCKET
    req.io?.emit('carBooking:created', {
      _id: String(doc._id), employeeId, category, tripDate, timeStart, timeEnd, status: doc.status
    })

    // TELEGRAM: employee created request (group only)
    try {
      console.log('[notify] REQUEST_CREATED', { bookingId: String(doc._id) })
      await notify('REQUEST_CREATED', { bookingId: doc._id, employeeName: employeeSnapshot?.name })
    } catch (e) {
      console.error('[notify error] REQUEST_CREATED', e?.message || e)
    }

    res.status(201).json(doc)
  } catch (err) { next(err) }
}

async function listMyBookings(req, res, next) {
  try {
    const { employeeId } = req.query
    if (!employeeId) throw createError(400, 'employeeId is required.')
    const list = await CarBooking.find({ employeeId }).sort({ createdAt: -1 }).lean()
    res.json(list)
  } catch (err) { next(err) }
}

/* ---------- admin ---------- */
async function updateStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body || {}
    const allowed = ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']
    if (!allowed.includes(status)) throw createError(400, 'Invalid status.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    const from = doc.status || 'PENDING'
    if (!FORWARD[from] || !FORWARD[from].has(status)) {
      throw createError(400, `Cannot change from ${from} to ${status}`)
    }

    doc.status = status
    await doc.save()

    // SOCKET
    req.io?.emit('carBooking:status', { bookingId: String(doc._id), status: doc.status })

    console.log('[status] updated', { bookingId: String(doc._id), newStatus: doc.status })

    // TELEGRAM: group + (if assigned) driver DM
    try {
      console.log('[notify] STATUS_CHANGED', { bookingId: String(doc._id), newStatus: doc.status })
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: doc.status, byName: req.user?.name })
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED', e?.message || e)
    }

    res.json(doc)
  } catch (err) { next(err) }
}

async function assignBooking(req, res, next) {
  try {
    const { id } = req.params
    const { driverId='', driverName='', vehicleId='', vehicleName='', notes='', assignedById='', assignedByName='', autoAccept=true } = req.body || {}

    if (!driverId) throw createError(400, 'driverId is required.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    let resolvedDriverName = driverName
    if (!resolvedDriverName && User) {
      const u = await User.findOne({ loginId: driverId }).lean()
      if (u?.name) resolvedDriverName = u.name
    }

    // clash check for the same driver/time
    const s = toMinutes(doc.timeStart), e = toMinutes(doc.timeEnd)
    const others = await CarBooking.find({
      _id: { $ne: doc._id },
      tripDate: doc.tripDate,
      'assignment.driverId': driverId,
      status: { $nin: ['CANCELLED'] }
    }).lean()
    const hasConflict = others.some(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd)))
    if (hasConflict) return res.status(409).json({ message: 'Driver is already assigned during this time.' })

    console.log('[assign] applying assignment', {
      bookingId: String(doc._id),
      driverId,
      driverName: resolvedDriverName || driverName || '',
      vehicleName,
      autoAccept
    })

    doc.assignment = {
      driverId,
      driverName: resolvedDriverName || driverName || '',
      vehicleId:  vehicleId || '',
      vehicleName: vehicleName || '',
      notes:      notes || '',
      assignedById:   assignedById || '',
      assignedByName: assignedByName || '',
      assignedAt:     new Date(),
      driverAck: 'PENDING',
      driverAckAt: undefined
    }

    if (autoAccept) {
      const from = doc.status || 'PENDING'
      if (!FORWARD[from] || !FORWARD[from].has('ACCEPTED')) {
        throw createError(400, `Cannot change from ${from} to ACCEPTED`)
      }
      doc.status = 'ACCEPTED'
    }

    await doc.save()

    // SOCKET
    req.io?.emit('carBooking:assigned', {
      bookingId: String(doc._id),
      driverId: doc.assignment.driverId,
      driverName: doc.assignment.driverName || '',
      tripDate: doc.tripDate,
      timeStart: doc.timeStart,
      timeEnd: doc.timeEnd,
      status: doc.status,
    })
    req.io?.emit('carBooking:status', { bookingId: String(doc._id), status: doc.status })

    console.log('[assign] saved & notifying', {
      bookingId: String(doc._id),
      status: doc.status,
      driverId: doc.assignment.driverId
    })

    // TELEGRAM: group + DM to assigned driver
    try {
      console.log('[notify] ADMIN_ACCEPTED_ASSIGNED', { bookingId: String(doc._id) })
      await notify('ADMIN_ACCEPTED_ASSIGNED', { bookingId: doc._id, byName: req.user?.name })
    } catch (e) {
      console.error('[notify error] ADMIN_ACCEPTED_ASSIGNED', e?.message || e)
    }

    res.json(doc)
  } catch (err) { next(err) }
}

async function listAdmin(req, res, next) {
  try {
    const { date, status } = req.query
    const filter = {}
    if (date) { if (!isValidDate(date)) throw createError(400, 'Invalid date.'); filter.tripDate = date }
    if (status && status !== 'ALL') filter.status = status
    const list = await CarBooking.find(filter).sort({ tripDate: 1, timeStart: 1 }).lean()
    res.json(list)
  } catch (err) { next(err) }
}

/* ---------- driver/messenger ---------- */
async function listForAssignee(req, res, next) {
  try {
    const { loginId } = pickIdentityFrom(req)
    if (!loginId) return res.json([])

    const { date, status } = req.query
    const filter = { 'assignment.driverId': loginId }
    if (date) filter.tripDate = date
    if (status && status !== 'ALL') filter.status = status

    const list = await CarBooking.find(filter).sort({ tripDate: 1, timeStart: 1 }).lean()
    res.json(list)
  } catch (err) { next(err) }
}

/* ---------- driver acknowledgment ---------- */
async function driverAcknowledge(req, res, next) {
  try {
    const { id } = req.params
    const { response } = req.body || {}
    const normalized = String(response || '').toUpperCase()
    if (!['ACCEPTED','DECLINED'].includes(normalized)) {
      throw createError(400, 'response must be ACCEPTED or DECLINED')
    }

    const { loginId } = pickIdentityFrom(req)
    if (!loginId) throw createError(401, 'Missing identity')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (String(doc.assignment?.driverId || '') !== String(loginId)) {
      throw createError(403, 'Not allowed: not the assigned driver.')
    }

    if (doc.assignment?.driverAck === normalized) {
      return res.json(doc)
    }

    doc.assignment = {
      ...(doc.assignment || {}),
      driverAck: normalized,
      driverAckAt: new Date()
    }
    await doc.save()

    req.io?.emit('carBooking:driverAck', {
      bookingId: String(doc._id),
      response: normalized,
      at: doc.assignment.driverAckAt
    })

    res.json(doc)
  } catch (err) { next(err) }
}

/* ---------- driver forward-only status ---------- */
async function driverUpdateStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body || {}
    const next = String(status || '').toUpperCase()
    const allowed = ['ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']
    if (!allowed.includes(next)) throw createError(400, 'Invalid status for driver.')

    const { loginId } = pickIdentityFrom(req)
    if (!loginId) throw createError(401, 'Missing identity')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (String(doc.assignment?.driverId || '') !== String(loginId)) {
      throw createError(403, 'Not allowed: not the assigned driver.')
    }

    if ((doc.assignment?.driverAck || 'PENDING') !== 'ACCEPTED') {
      throw createError(400, 'Please accept the assignment first.')
    }

    const from = doc.status || 'PENDING'
    if (!FORWARD[from] || !FORWARD[from].has(next)) {
      throw createError(400, `Cannot change from ${from} to ${next}`)
    }

    doc.status = next
    await doc.save()

    req.io?.emit('carBooking:status', { bookingId: String(doc._id), status: doc.status })

    console.log('[driverStatus] updated by driver', { bookingId: String(doc._id), newStatus: doc.status })

    // TELEGRAM: group + (if assigned) driver DM
    try {
      console.log('[notify] STATUS_CHANGED (driver)', { bookingId: String(doc._id), newStatus: doc.status })
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: doc.status, byName: req.user?.name })
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED (driver)', e?.message || e)
    }

    res.json(doc)
  } catch (err) { next(err) }
}

module.exports = {
  checkAvailability,
  createBooking,
  listMyBookings,
  updateStatus,
  assignBooking,
  listAdmin,
  listForAssignee,
  driverAcknowledge,
  driverUpdateStatus,
}
