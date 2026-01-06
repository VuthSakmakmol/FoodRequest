// backend/controllers/transportation/carBooking.controller.js
const createError = require('http-errors')
const CarBooking = require('../../models/transportation/CarBooking')

let User = null
try { User = require('../../models/User') } catch { User = null }

let Employee = null
try { Employee = require('../models/Employee') } catch {
  try { Employee = require('../../models/EmployeeDirectory') } catch { Employee = null }
}

const { broadcastCarBooking } = require('../../utils/realtime')
const { toMinutes, overlaps, isValidDate } = require('../../utils/time')
const { notify } = require('../../services/transport.telegram.notify')

const AIRPORT_DESTINATION = 'Techo International Airport'

const MAX_CAR = 3
const MAX_MSGR = 1

// ───────── status workflow (with COMEBACK) ─────────
// Main path for driver: PENDING → ACCEPTED → ON_ROAD → ARRIVING → COMEBACK → COMPLETED
// DELAYED / CANCELLED are side branches.
const FORWARD = {
  PENDING:   new Set(['ACCEPTED', 'CANCELLED']),
  ACCEPTED:  new Set(['ON_ROAD', 'DELAYED', 'CANCELLED']),
  ON_ROAD:   new Set(['ARRIVING', 'DELAYED', 'CANCELLED']),
  ARRIVING:  new Set(['COMEBACK', 'DELAYED', 'CANCELLED']),
  COMEBACK:  new Set(['COMPLETED', 'DELAYED', 'CANCELLED']),
  DELAYED:   new Set(['ON_ROAD', 'ARRIVING', 'COMEBACK', 'CANCELLED']),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
}

// allowed statuses for admin updateStatus
const ALLOWED_STATUS = [
  'PENDING',
  'ACCEPTED',
  'ON_ROAD',
  'ARRIVING',
  'COMEBACK',
  'COMPLETED',
  'DELAYED',
  'CANCELLED',
]

/* ───────── assignment helpers ───────── */
function hasAssignee(doc) {
  if (!doc?.assignment) return false
  if (doc.category === 'Messenger') return !!doc.assignment.messengerId
  return !!doc.assignment.driverId
}

function assigneeIdOf(doc) {
  return doc?.category === 'Messenger'
    ? (doc?.assignment?.messengerId || '')
    : (doc?.assignment?.driverId || '')
}

/* ───────── helpers ───────── */
function parsePayload(req) {
  if (req.file) {
    if (!req.body?.data) throw createError(400, 'Missing "data" field in multipart form.')
    try { return JSON.parse(req.body.data) }
    catch { throw createError(400, 'Invalid JSON in "data".') }
  }
  return req.body || {}
}

function pickIdentityFrom(req) {
  const loginId =
    req.headers['x-login-id'] ||
    req.user?.loginId ||
    req.query.loginId ||
    req.session?.user?.loginId ||
    req.cookies?.loginId ||
    ''

  const role =
    (
      req.headers['x-role'] ||
      req.user?.role ||
      req.query.role ||
      req.session?.user?.role ||
      req.cookies?.role ||
      ''
    )
      .toString()
      .toUpperCase()

  return { loginId: String(loginId || ''), role }
}

/* ✅ RESERVED-ONLY availability filter
   - Cars are "reserved" only when a driver or vehicle is assigned.
   - Messenger is "reserved" only when messengerId is assigned (can be on Messenger OR Car category).
*/
function buildReservedQuery({ tripDate, category, excludeId = null }) {
  const base = {
    tripDate,
    status: { $nin: ['CANCELLED'] },
  }
  if (excludeId) base._id = { $ne: excludeId }

  if (category === 'Car') {
    return {
      ...base,
      category: 'Car',
      $or: [
        { 'assignment.driverId': { $exists: true, $ne: '' } },
        { 'assignment.vehicleId': { $exists: true, $ne: '' } },
      ],
    }
  }

  // Messenger (counts messenger assigned on Messenger bookings OR Car bookings)
  return {
    ...base,
    $or: [
      { category: 'Messenger', 'assignment.messengerId': { $exists: true, $ne: '' } },
      { category: 'Car',       'assignment.messengerId': { $exists: true, $ne: '' } },
    ],
  }
}

async function employeeCancelBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params

    // Get employeeId from token/header/body/query (flexible)
    const employeeId =
      (req.user?.employeeId) ||
      (req.headers['x-employee-id']) ||
      (req.body?.employeeId) ||
      (req.query?.employeeId) ||
      ''

    const me = String(employeeId || '').trim()
    if (!me) throw createError(401, 'Missing employee identity.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    // Only owner can cancel
    if (String(doc.employeeId || '').trim() !== me) {
      throw createError(403, 'Not allowed: not your booking.')
    }

    // Match your frontend rules
    const st = String(doc.status || '').toUpperCase()
    if (['ON_ROAD', 'ARRIVING', 'COMEBACK', 'COMPLETED', 'CANCELLED'].includes(st)) {
      throw createError(400, `Cannot cancel when status is ${st}.`)
    }

    // Block past-date cancel (Phnom Penh date)
    if (doc.tripDate && isValidDate(doc.tripDate)) {
      const todayPP = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' }) // YYYY-MM-DD
      if (String(doc.tripDate) < String(todayPP)) {
        throw createError(400, 'Cannot cancel a past booking.')
      }
    }

    doc.status = 'CANCELLED'
    await doc.save()

    // Notify realtime
    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    // Optional: notify telegram (safe even if not implemented in notify)
    try {
      await notify('REQUEST_CANCELLED', { bookingId: doc._id, by: me })
    } catch {}

    res.json({ ok: true, status: doc.status })
  } catch (err) {
    next(err)
  }
}


/** Minimal (but slightly richer) delta payloads */
const shape = {
  created: (doc) => ({
    bookingId: String(doc._id),
    _id: String(doc._id),
    employeeId: doc.employeeId,
    employee: doc.employee || null,
    category: doc.category,
    tripDate: doc.tripDate,
    timeStart: doc.timeStart,
    timeEnd: doc.timeEnd,
    passengers: doc.passengers,
    customerContact: doc.customerContact,
    stops: doc.stops || [],
    purpose: doc.purpose || '',
    notes: doc.notes || '',
    ticketUrl: doc.ticketUrl || '',
    status: doc.status,
    assignment: doc.assignment || {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }),
  status: (doc) => ({
    bookingId: String(doc._id),
    status: doc.status,
  }),
  assigned: (doc) => ({
    bookingId: String(doc._id),

    driverId: doc.assignment?.driverId || '',
    driverName: doc.assignment?.driverName || '',

    messengerId: doc.assignment?.messengerId || '',
    messengerName: doc.assignment?.messengerName || '',

    vehicleId: doc.assignment?.vehicleId || '',
    vehicleName: doc.assignment?.vehicleName || '',

    tripDate: doc.tripDate,
    timeStart: doc.timeStart,
    timeEnd: doc.timeEnd,
    status: doc.status,
    category: doc.category,
  }),
  driverAck: (doc) => ({
    bookingId: String(doc._id),
    response: doc.assignment?.driverAck || 'PENDING',
    at: doc.assignment?.driverAckAt || null,
  }),
  messengerAck: (doc) => ({
    bookingId: String(doc._id),
    response: doc.assignment?.messengerAck || 'PENDING',
    at: doc.assignment?.messengerAckAt || null,
  }),
  updated: (doc) => ({
    bookingId: String(doc._id),
    patch: {
      category: doc.category,
      tripDate: doc.tripDate,
      timeStart: doc.timeStart,
      timeEnd: doc.timeEnd,
      passengers: doc.passengers,
      customerContact: doc.customerContact,
      stops: doc.stops || [],
      purpose: doc.purpose || '',
      notes: doc.notes || '',
      ticketUrl: doc.ticketUrl || '',
    },
  }),
  deleted: (doc) => ({
    bookingId: String(doc._id),
  }),
}

/* ───────── public ───────── */
async function checkAvailability(req, res, next) {
  try {
    const { date, start, end, category } = req.query
    if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
    if (!start || !end) throw createError(400, 'start and end are required (HH:MM).')
    if (!['Car', 'Messenger'].includes(category)) throw createError(400, 'Invalid category.')

    const s = toMinutes(start)
    const e = toMinutes(end)
    if (e <= s) throw createError(400, 'End must be after Start.')

    // ✅ IMPORTANT: availability counts only RESERVED (assigned) resources
    const reservedQuery = buildReservedQuery({ tripDate: date, category })
    const docs = await CarBooking.find(reservedQuery).lean()

    const busy = docs.filter(b =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    res.json({ date, start, end, category, busy, max, available: Math.max(0, max - busy) })
  } catch (err) { next(err) }
}

/** PUBLIC schedule */
async function listSchedulePublic(req, res, next) {
  try {
    const { date, category, status, driverId } = req.query

    const filter = {}
    if (date) {
      if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
      filter.tripDate = date
    }
    if (category && (category === 'Car' || category === 'Messenger')) filter.category = category
    if (status && status !== 'ALL') filter.status = status
    if (driverId) filter['assignment.driverId'] = String(driverId)

    const list = await CarBooking
      .find(filter)
      .sort({ tripDate: 1, timeStart: 1 })
      .lean()

    res.json(list)
  } catch (err) { next(err) }
}

async function createBooking(req, res, next) {
  try {
    const io = req.io
    const payload = parsePayload(req)
    const {
      employeeId, category, tripDate, timeStart, timeEnd,
      passengers, customerContact, stops, purpose, notes
    } = payload

    if (!employeeId) throw createError(400, 'employeeId is required.')
    if (!['Car', 'Messenger'].includes(category)) throw createError(400, 'Invalid category.')
    if (!isValidDate(tripDate)) throw createError(400, 'Invalid tripDate (YYYY-MM-DD).')
    if (!timeStart || !timeEnd) throw createError(400, 'timeStart and timeEnd are required (HH:MM).')

    const s = toMinutes(timeStart)
    const e = toMinutes(timeEnd)
    if (e <= s) throw createError(400, 'End must be after Start.')

    if (!Array.isArray(stops) || stops.length === 0)
      throw createError(400, 'At least one destination (stop) is required.')

    for (let i = 0; i < stops.length; i++) {
      const st = stops[i]
      if (!st?.destination) throw createError(400, `Stop ${i + 1}: destination is required.`)
      if (st.destination === 'Other' && !st.destinationOther)
        throw createError(400, `Stop ${i + 1}: destinationOther is required for "Other".`)
    }

    const hasAirport = stops.some(st => st.destination === AIRPORT_DESTINATION)
    let ticketUrl = ''
    if (hasAirport) {
      if (!req.file) {
        throw createError(400, 'Airplane ticket is required for Techo International Airport destination.')
      }
      ticketUrl = `/uploads/${req.file.filename}`
    } else if (req.file) {
      ticketUrl = `/uploads/${req.file.filename}`
    }

    // ✅ IMPORTANT: capacity check uses RESERVED ONLY (assigned driver/vehicle/messenger),
    // so pending/unassigned requests won't reduce availability.
    const reservedQuery = buildReservedQuery({ tripDate, category })
    const reserved = await CarBooking.find(reservedQuery).lean()
    const overlapping = reserved.filter(b =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    if (overlapping >= max) {
      return res
        .status(409)
        .json({ message: `No ${category.toLowerCase()} available for ${tripDate} ${timeStart}-${timeEnd}.` })
    }

    let employeeSnapshot = { employeeId, name: '', department: '', contactNumber: '' }
    if (Employee) {
      const emp = await Employee.findOne({ employeeId }).lean()
      if (emp) {
        employeeSnapshot = {
          employeeId: emp.employeeId,
          name: emp.name || '',
          department: emp.department || '',
          contactNumber: emp.contactNumber || '',
        }
      }
    }

    const doc = await CarBooking.create({
      employeeId,
      employee: employeeSnapshot,
      category, tripDate, timeStart, timeEnd,
      passengers: Number(passengers || 1),
      customerContact: customerContact || '',
      stops,
      purpose: purpose || '',
      notes: notes || '',
      ticketUrl,
    })

    broadcastCarBooking(io, doc, 'carBooking:created', shape.created(doc))

    try {
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

/* ───────── ADMIN: update status (Actions buttons + reopen) ───────── */
async function updateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { status, forceReopen } = req.body || {}
    if (!ALLOWED_STATUS.includes(status)) throw createError(400, 'Invalid status.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    const from = doc.status || 'PENDING'
    const nextStatus = status

    // Re-open to PENDING when editing schedule (even if already PENDING),
    // but never from COMPLETED / CANCELLED.
    const isReopen =
      !!forceReopen &&
      nextStatus === 'PENDING' &&
      !['COMPLETED', 'CANCELLED'].includes(from)

    if (isReopen) {
      doc.status = 'PENDING'
      if (doc.assignment) {
        doc.assignment.driverAck = 'PENDING'
        doc.assignment.messengerAck = 'PENDING'
      }
    } else {
      // Normal forward move
      if (!FORWARD[from] || !FORWARD[from].has(nextStatus)) {
        throw createError(400, `Cannot change from ${from} to ${nextStatus}`)
      }

      if (nextStatus !== 'CANCELLED' && !hasAssignee(doc)) {
        throw createError(400, 'You must assign a Driver/Messenger before changing status.')
      }

      doc.status = nextStatus
    }

    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: doc.status, byName: req.user?.name })
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED', e?.message || e)
    }

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── ADMIN assign booking (driver or messenger – symmetric) ───────── */
async function assignBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    let {
      driverId = '',
      driverName = '',
      vehicleId = '',
      vehicleName = '',
      notes = '',
      assignedById = '',
      assignedByName = '',
      autoAccept = true,
      role = 'DRIVER',
    } = req.body || {}

    if (!driverId) throw createError(400, 'driverId (loginId) is required.')
    role = String(role).toUpperCase()
    if (!['DRIVER', 'MESSENGER'].includes(role)) {
      throw createError(400, 'role must be DRIVER or MESSENGER')
    }

    driverId = String(driverId).trim().toLowerCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    // resolve driver/messenger name from User collection if needed
    let resolvedName = driverName
    if (!resolvedName && User) {
      const u = await User.findOne({ loginId: driverId }).lean()
      if (u?.name) resolvedName = u.name
    }

    const s = toMinutes(doc.timeStart)
    const e = toMinutes(doc.timeEnd)
    const conflictField = role === 'MESSENGER' ? 'assignment.messengerId' : 'assignment.driverId'

    const conflictQuery = {
      _id: { $ne: doc._id },
      tripDate: doc.tripDate,
      status: { $nin: ['CANCELLED'] },
      [conflictField]: driverId,
    }

    const others = await CarBooking.find(conflictQuery).lean()
    const hasConflict = others.some(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd)))
    if (hasConflict) {
      const label = role === 'MESSENGER' ? 'Messenger' : 'Driver'
      return res.status(409).json({ message: `${label} already assigned during this time.` })
    }

    // base assignment – reset both acks to PENDING whenever admin re-assigns
    const baseAssign = {
      vehicleId: vehicleId || '',
      vehicleName: vehicleName || '',
      notes: notes || '',
      assignedById: assignedById || '',
      assignedByName: assignedByName || '',
      assignedAt: new Date(),
      driverAck: 'PENDING',
      messengerAck: 'PENDING',
      driverAckAt: undefined,
      messengerAckAt: undefined,
    }

    if (role === 'MESSENGER') {
      doc.category = 'Messenger'
      doc.assignment = {
        ...baseAssign,
        messengerId: driverId,
        messengerName: resolvedName || driverName || '',
        driverId: '',
        driverName: '',
      }
    } else {
      doc.category = 'Car'
      doc.assignment = {
        ...baseAssign,
        driverId: driverId,
        driverName: resolvedName || driverName || '',
        messengerId: '',
        messengerName: '',
      }
    }

    // Business rule: admin assigning means admin already ACCEPTED the job.
    if (autoAccept) {
      const from = doc.status || 'PENDING'
      if (!FORWARD[from] || !FORWARD[from].has('ACCEPTED')) {
        throw createError(400, `Cannot change from ${from} to ACCEPTED`)
      }
      doc.status = 'ACCEPTED'
    }

    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:assigned', shape.assigned(doc))
    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('ADMIN_ACCEPTED_ASSIGNED', {
        bookingId: doc._id,
        byName: req.user?.name || assignedByName || 'System',
      })
    } catch (e) {
      console.error('[notify error] ADMIN_ACCEPTED_ASSIGNED', e?.message || e)
    }

    res.json(doc)
  } catch (err) {
    console.error('[assignBooking error]', err)
    next(err)
  }
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

/* ───────── LIST FOR ASSIGNEE (driver or messenger – symmetric) ───────── */
async function listForAssignee(req, res, next) {
  try {
    const { loginId, role } = pickIdentityFrom(req)
    const driverId = req.query.driverId || loginId
    if (!driverId) return res.json([])

    const { date, status } = req.query
    const filter = {}

    if (role === 'DRIVER') {
      filter.category = 'Car'
      filter['assignment.driverId'] = driverId
    } else if (role === 'MESSENGER') {
      filter.$or = [
        { category: 'Messenger', 'assignment.messengerId': driverId },
        { category: 'Car', 'assignment.messengerId': driverId },
      ]
    } else {
      // fallback: treat as employee
      filter.employeeId = driverId
    }

    if (date) filter.tripDate = date
    if (status && status !== 'ALL') filter.status = status

    const list = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    res.json(list)
  } catch (err) {
    console.error('[ListForAssignee error]', err)
    next(err)
  }
}

/* ───────── DRIVER ACK (only ack, status unchanged) ───────── */
async function driverAcknowledge(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { response } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const normalized = (response || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.driverId) !== String(loginId))
      throw createError(403, 'Not allowed: not your booking')

    doc.assignment.driverAck = normalized
    doc.assignment.driverAckAt = new Date()
    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:driverAck', shape.driverAck(doc))

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── DRIVER STATUS ───────── */
async function driverUpdateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { status } = req.body || {}
    const { loginId } = pickIdentityFrom(req)

    if (!status) throw createError(400, 'Status is required.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (String(doc.assignment?.driverId) !== String(loginId)) {
      throw createError(403, 'Not allowed: not your assigned booking.')
    }

    const from = doc.status || 'PENDING'
    const nextStatus = (status || '').toUpperCase()
    if (!FORWARD[from] || !FORWARD[from].has(nextStatus)) {
      throw createError(400, `Cannot change from ${from} to ${nextStatus}`)
    }

    if (!hasAssignee(doc)) throw createError(400, 'Booking is not assigned.')

    doc.status = nextStatus
    doc.updatedAt = new Date()
    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: nextStatus, byName: loginId })
    } catch (err) {
      console.error('[notify error] STATUS_CHANGED', err?.message || err)
    }

    res.json({ ok: true, message: 'Status updated', status: nextStatus })
  } catch (err) {
    console.error('Update status error', err)
    next(err)
  }
}

/* ───────── UPDATE BOOKING (admin edit schedule / category / purpose) ───────── */
async function updateBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const payload = parsePayload(req)

    if ('status' in payload || 'assignment' in payload) {
      throw createError(400, 'Not allowed to modify status/assignment here.')
    }

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    const editable = [
      'category', 'tripDate', 'timeStart', 'timeEnd', 'passengers',
      'customerContact', 'stops', 'purpose', 'notes', 'ticketUrl',
    ]
    for (const k of editable) {
      if (payload[k] !== undefined) doc[k] = payload[k]
    }

    if (doc.timeStart && doc.timeEnd) {
      const s = toMinutes(doc.timeStart)
      const e = toMinutes(doc.timeEnd)
      if (e <= s) throw createError(400, 'End must be after Start.')
    } else {
      throw createError(400, 'timeStart and timeEnd are required.')
    }

    if (!isValidDate(doc.tripDate)) {
      throw createError(400, 'Invalid tripDate (YYYY-MM-DD).')
    }
    if (!['Car', 'Messenger'].includes(doc.category)) {
      throw createError(400, 'Invalid category.')
    }

    const s = toMinutes(doc.timeStart)
    const e = toMinutes(doc.timeEnd)

    // ✅ IMPORTANT: capacity check uses RESERVED ONLY (assigned)
    const reservedQuery = buildReservedQuery({
      tripDate: doc.tripDate,
      category: doc.category,
      excludeId: doc._id,
    })

    const reserved = await CarBooking.find(reservedQuery).lean()
    const overlapping = reserved.filter(b =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = doc.category === 'Car' ? MAX_CAR : MAX_MSGR
    if (overlapping >= max) {
      throw createError(
        409,
        `No ${doc.category.toLowerCase()} available for ${doc.tripDate} ${doc.timeStart}-${doc.timeEnd}.`
      )
    }

    // extra: keep existing per-assignee conflict checks
    const ass = doc.assignment || {}

    if (ass.driverId) {
      const others = await CarBooking.find({
        _id: { $ne: doc._id },
        tripDate: doc.tripDate,
        status: { $nin: ['CANCELLED'] },
        'assignment.driverId': ass.driverId,
      }).lean()

      const hasConflict = others.some(b =>
        overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
      )

      if (hasConflict) {
        throw createError(409, 'Driver already assigned during this time.')
      }
    }

    if (ass.messengerId) {
      const othersM = await CarBooking.find({
        _id: { $ne: doc._id },
        tripDate: doc.tripDate,
        status: { $nin: ['CANCELLED'] },
        'assignment.messengerId': ass.messengerId,
      }).lean()

      const hasConflictM = othersM.some(b =>
        overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
      )

      if (hasConflictM) {
        throw createError(409, 'Messenger already assigned during this time.')
      }
    }

    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:updated', shape.updated(doc))

    try {
      await notify('REQUEST_UPDATED', { bookingId: doc._id })
    } catch {}

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── DELETE BOOKING ───────── */
async function deleteBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    await CarBooking.deleteOne({ _id: id })

    broadcastCarBooking(io, doc, 'carBooking:deleted', shape.deleted(doc))

    try {
      await notify('REQUEST_DELETED', { bookingId: doc._id })
    } catch {}

    res.json({ ok: true })
  } catch (err) { next(err) }
}

/* ───────── MESSENGER ACK (only ack, status unchanged) ───────── */
async function messengerAcknowledge(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { response } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const normalized = (response || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.messengerId) !== String(loginId))
      throw createError(403, 'Not allowed: not your booking')

    doc.assignment.messengerAck = normalized
    doc.assignment.messengerAckAt = new Date()
    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:messengerAck', shape.messengerAck(doc))

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── MESSENGER STATUS (same logic as driver) ───────── */
async function messengerUpdateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { status } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const nextStatus = (status || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.messengerId) !== String(loginId))
      throw createError(403, 'Not allowed')

    const from = doc.status || 'PENDING'
    if (!FORWARD[from] || !FORWARD[from].has(nextStatus)) {
      throw createError(400, `Cannot change from ${from} to ${nextStatus}`)
    }
    if (!hasAssignee(doc)) throw createError(400, 'Booking is not assigned.')

    doc.status = nextStatus
    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('STATUS_CHANGED', {
        bookingId: doc._id,
        newStatus: nextStatus,
        byName: loginId,
      })
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED', e?.message || e)
    }

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── LIST messenger tasks (legacy helper) ───────── */
async function listMessengerTasks(req, res) {
  try {
    const messengerId = req.query.messengerId || req.headers['x-login-id']
    if (!messengerId) return res.status(400).json({ message: 'messengerId missing' })

    const filter = {
      $or: [
        { category: 'Messenger', 'assignment.messengerId': messengerId },
        { category: 'Car', 'assignment.messengerId': messengerId },
      ],
    }

    if (req.query.date) filter.tripDate = req.query.date
    if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status

    const rows = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    if (!rows.length) return res.status(404).json({ message: 'Not found' })
    res.json(rows)
  } catch (err) {
    console.error('listMessengerTasks error', err)
    res.status(500).json({ message: err.message || 'Internal error' })
  }
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
  messengerAcknowledge,
  messengerUpdateStatus,
  updateBooking,
  deleteBooking,
  listSchedulePublic,
  listMessengerTasks,
  employeeCancelBooking,
}
