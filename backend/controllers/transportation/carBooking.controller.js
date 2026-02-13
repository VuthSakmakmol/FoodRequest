// backend/controllers/transportation/carBooking.controller.js
const createError = require('http-errors')
const CarBooking = require('../../models/transportation/CarBooking')

let User = null
try { User = require('../../models/User') } catch { User = null }

const XLSX = require('xlsx')

let Employee = null
try { Employee = require('../models/Employee') } catch {
  try { Employee = require('../../models/EmployeeDirectory') } catch { Employee = null }
}

const { broadcastCarBooking } = require('../../utils/realtime')
const { toMinutes, overlaps, isValidDate } = require('../../utils/time')
const { notify } = require('../../services/transport.telegram.notify')

const AIRPORT_DESTINATION = 'Techo International Airport'

// ✅ If a booking is COMPLETED, driver/messenger should be considered FREE for new assignments.
// (Same as CANCELLED: does not block time.)
const NON_BLOCKING_STATUSES = ['CANCELLED', 'COMPLETED']

const MAX_CAR = 3
const MAX_MSGR = 1

// ───────── status workflow (with COMEBACK) ─────────
const FORWARD = {
  PENDING: new Set(['ACCEPTED', 'CANCELLED']),
  ACCEPTED: new Set(['ON_ROAD', 'DELAYED', 'CANCELLED']),
  ON_ROAD: new Set(['ARRIVING', 'DELAYED', 'CANCELLED']),
  ARRIVING: new Set(['COMEBACK', 'DELAYED', 'CANCELLED']),
  COMEBACK: new Set(['COMPLETED', 'DELAYED', 'CANCELLED']),
  DELAYED: new Set(['ON_ROAD', 'ARRIVING', 'COMEBACK', 'CANCELLED']),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
}

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

function safeStr(v) {
  return String(v ?? '').trim()
}

function stopsText(stops = []) {
  if (!Array.isArray(stops) || !stops.length) return ''
  return stops
    .map((s) => {
      const dest = s?.destination === 'Other' ? (s?.destinationOther || 'Other') : (s?.destination || '')
      return safeStr(dest)
    })
    .filter(Boolean)
    .join(' → ')
}

/**
 * ✅ SINGLE source of truth for date-range filtering:
 * - If dateFrom/dateTo provided -> filter ALL dates in range
 * - Else if date provided -> single day
 * Also supports status/category/q for both list + export
 */
function buildRangeFilter({ date, dateFrom, dateTo, status, category, q }) {
  const filter = {}

  const from = safeStr(dateFrom)
  const to = safeStr(dateTo)
  const single = safeStr(date)

  // ✅ Range has priority
  if (from || to) {
    if (from && !isValidDate(from)) throw createError(400, 'Invalid dateFrom (YYYY-MM-DD).')
    if (to && !isValidDate(to)) throw createError(400, 'Invalid dateTo (YYYY-MM-DD).')

    const f = from || to
    const t = to || from
    if (f && t && f > t) throw createError(400, 'dateFrom must be <= dateTo.')

    // tripDate stored as "YYYY-MM-DD" string -> lexicographic works
    filter.tripDate = { $gte: f, $lte: t }
  } else if (single) {
    if (!isValidDate(single)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
    filter.tripDate = single
  }

  if (status && status !== 'ALL') filter.status = String(status).toUpperCase()
  if (category && category !== 'ALL') filter.category = String(category)

  const term = safeStr(q).toLowerCase()
  if (term) {
    filter.$or = [
      { employeeId: new RegExp(term, 'i') },
      { 'employee.name': new RegExp(term, 'i') },
      { 'employee.department': new RegExp(term, 'i') },
      { purpose: new RegExp(term, 'i') },
      { notes: new RegExp(term, 'i') },
      { 'assignment.driverId': new RegExp(term, 'i') },
      { 'assignment.driverName': new RegExp(term, 'i') },
      { 'assignment.messengerId': new RegExp(term, 'i') },
      { 'assignment.messengerName': new RegExp(term, 'i') },
      { 'assignment.vehicleId': new RegExp(term, 'i') },
      { 'assignment.vehicleName': new RegExp(term, 'i') },
      { 'stops.destination': new RegExp(term, 'i') },
      { 'stops.destinationOther': new RegExp(term, 'i') },
    ]
  }

  return filter
}

async function exportAdminExcel(req, res, next) {
  try {
    const { date, dateFrom, dateTo, status, category, q } = req.query || {}
    const filter = buildRangeFilter({ date, dateFrom, dateTo, status, category, q })

    // ✅ NO LIMIT — export everything in range (100+ ok)
    const list = await CarBooking.find(filter)
      .sort({ tripDate: 1, timeStart: 1 })
      .lean()

    const rows = (list || []).map((b, idx) => {
      const cat = safeStr(b.category) || 'Car'
      const isMessenger = cat === 'Messenger'

      const driverId = safeStr(b?.assignment?.driverId)
      const driverName = safeStr(b?.assignment?.driverName)
      const messengerId = safeStr(b?.assignment?.messengerId)
      const messengerName = safeStr(b?.assignment?.messengerName)

      const assignedTo = isMessenger
        ? (messengerName || messengerId)
        : (driverName || driverId)

      const ack = isMessenger
        ? safeStr(b?.assignment?.messengerAck) || 'PENDING'
        : safeStr(b?.assignment?.driverAck) || 'PENDING'

      return {
        No: idx + 1,
        Date: safeStr(b.tripDate),
        Start: safeStr(b.timeStart),
        End: safeStr(b.timeEnd),
        Category: cat,
        Status: safeStr(b.status),
        RequesterId: safeStr(b.employeeId),
        RequesterName: safeStr(b?.employee?.name),
        Department: safeStr(b?.employee?.department),
        Contact: safeStr(b?.employee?.contactNumber) || safeStr(b.customerContact),
        Pax: Number(b.passengers || 1),
        Destination: stopsText(b.stops),
        Purpose: safeStr(b.purpose),
        Notes: safeStr(b.notes),
        TicketUrl: safeStr(b.ticketUrl),
        AssignedTo: safeStr(assignedTo) || 'Unassigned',
        Response: ack,
        DriverId: driverId,
        DriverName: driverName,
        MessengerId: messengerId,
        MessengerName: messengerName,
        VehicleId: safeStr(b?.assignment?.vehicleId),
        VehicleName: safeStr(b?.assignment?.vehicleName),
        CreatedAt: b.createdAt ? new Date(b.createdAt).toISOString() : '',
        UpdatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : '',
      }
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 5 }, { wch: 45 },
      { wch: 35 }, { wch: 35 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
      { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 24 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'CarBookings')

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })

    const f = safeStr(dateFrom) || safeStr(date) || ''
    const t = safeStr(dateTo) || safeStr(date) || ''

    const filename =
      (f || t)
        ? `car-bookings_${f || t}_to_${t || f}.xlsx`
        : `car-bookings_all.xlsx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buf)
  } catch (err) {
    next(err)
  }
}

/* ✅ RESERVED-ONLY availability filter */
function buildReservedQuery({ tripDate, category, excludeId = null }) {
  const base = {
    tripDate,
    status: { $nin: NON_BLOCKING_STATUSES },
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

  return {
    ...base,
    $or: [
      { category: 'Messenger', 'assignment.messengerId': { $exists: true, $ne: '' } },
      { category: 'Car', 'assignment.messengerId': { $exists: true, $ne: '' } },
    ],
  }
}

async function employeeCancelBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params

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

    if (String(doc.employeeId || '').trim() !== me) {
      throw createError(403, 'Not allowed: not your booking.')
    }

    const st = String(doc.status || '').toUpperCase()
    if (['ON_ROAD', 'ARRIVING', 'COMEBACK', 'COMPLETED', 'CANCELLED'].includes(st)) {
      throw createError(400, `Cannot cancel when status is ${st}.`)
    }

    if (doc.tripDate && isValidDate(doc.tripDate)) {
      const todayPP = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
      if (String(doc.tripDate) < String(todayPP)) {
        throw createError(400, 'Cannot cancel a past booking.')
      }
    }

    doc.status = 'CANCELLED'
    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

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

  assigned: (doc, meta = {}) => ({
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

    prevAssigneeId: meta.prevAssigneeId || '',
    prevAssigneeName: meta.prevAssigneeName || '',
    prevRole: meta.prevRole || '',
    action: meta.action || 'ASSIGN',
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

    const reservedQuery = buildReservedQuery({ tripDate: date, category })
    const docs = await CarBooking.find(reservedQuery).lean()

    const busy = docs.filter((b) =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    res.json({ date, start, end, category, busy, max, available: Math.max(0, max - busy) })
  } catch (err) { next(err) }
}

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

    const list = await CarBooking.find(filter)
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

    const hasAirport = stops.some((st) => st.destination === AIRPORT_DESTINATION)
    let ticketUrl = ''
    if (hasAirport) {
      if (!req.file) {
        throw createError(400, 'Airplane ticket is required for Techo International Airport destination.')
      }
      ticketUrl = `/uploads/${req.file.filename}`
    } else if (req.file) {
      ticketUrl = `/uploads/${req.file.filename}`
    }

    const reservedQuery = buildReservedQuery({ tripDate, category })
    const reserved = await CarBooking.find(reservedQuery).lean()
    const overlapping = reserved.filter((b) =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = category === 'Car' ? MAX_CAR : MAX_MSGR
    if (overlapping >= max) {
      return res.status(409).json({
        message: `No ${category.toLowerCase()} available for ${tripDate} ${timeStart}-${timeEnd}.`,
      })
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

/* ───────── ADMIN: update status ───────── */
async function updateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params

    const {
      status,
      forceReopen,
      force,
      forceComplete,
    } = req.body || {}

    const nextStatus = String(status || '').toUpperCase()
    if (!ALLOWED_STATUS.includes(nextStatus)) throw createError(400, 'Invalid status.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    const from = String(doc.status || 'PENDING').toUpperCase()

    const isForceComplete =
      (forceComplete === true || force === true) &&
      nextStatus === 'COMPLETED' &&
      !['COMPLETED', 'CANCELLED'].includes(from)

    const isReopen =
      !!forceReopen &&
      nextStatus === 'PENDING' &&
      !['COMPLETED', 'CANCELLED'].includes(from)

    if (isReopen) {
      doc.status = 'PENDING'
      if (doc.assignment) {
        doc.assignment.driverAck = 'PENDING'
        doc.assignment.messengerAck = 'PENDING'
        doc.assignment.driverAckAt = undefined
        doc.assignment.messengerAckAt = undefined
      }
    } else if (isForceComplete) {
      if (!hasAssignee(doc)) {
        throw createError(400, 'You must assign a Driver/Messenger before marking COMPLETED.')
      }

      if (doc.assignment?.driverId && doc.assignment.driverAck === 'PENDING') {
        doc.assignment.driverAck = 'ACCEPTED'
        doc.assignment.driverAckAt = doc.assignment.driverAckAt || new Date()
      }
      if (doc.assignment?.messengerId && doc.assignment.messengerAck === 'PENDING') {
        doc.assignment.messengerAck = 'ACCEPTED'
        doc.assignment.messengerAckAt = doc.assignment.messengerAckAt || new Date()
      }

      doc.status = 'COMPLETED'
      doc.updatedAt = new Date()
    } else {
      if (!FORWARD[from] || !FORWARD[from].has(nextStatus)) {
        throw createError(400, `Cannot change from ${from} to ${nextStatus}`)
      }

      if (nextStatus !== 'CANCELLED' && !hasAssignee(doc)) {
        throw createError(400, 'You must assign a Driver/Messenger before changing status.')
      }

      doc.status = nextStatus
      doc.updatedAt = new Date()
    }

    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: doc.status, byName: req.user?.name })
    } catch {}

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ───────── ADMIN assign / reassign / unassign ───────── */
async function assignBooking(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params

    let {
      role = '',

      driverId = '',
      driverName = '',

      messengerId = '',
      messengerName = '',

      vehicleId = '',
      vehicleName = '',

      notes = '',
      assignedById = '',
      assignedByName = '',

      autoAccept = true,
    } = req.body || {}

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    role = String(role || '').toUpperCase()

    const allowedRoles =
      doc.category === 'Messenger'
        ? new Set(['MESSENGER'])
        : new Set(['DRIVER', 'MESSENGER'])

    if (!allowedRoles.has(role)) {
      role = doc.category === 'Messenger' ? 'MESSENGER' : 'DRIVER'
    }

    const prevAssigneeId =
      role === 'MESSENGER'
        ? String(doc.assignment?.messengerId || '')
        : String(doc.assignment?.driverId || '')

    const prevAssigneeName =
      role === 'MESSENGER'
        ? String(doc.assignment?.messengerName || '')
        : String(doc.assignment?.driverName || '')

    const incomingId =
      role === 'MESSENGER'
        ? String(messengerId || driverId || '').trim().toLowerCase()
        : String(driverId || '').trim().toLowerCase()

    const incomingName =
      role === 'MESSENGER'
        ? String(messengerName || driverName || '').trim()
        : String(driverName || '').trim()

    if (!incomingId) {
      if (!doc.assignment) doc.assignment = {}

      doc.assignment.assignedById = assignedById || ''
      doc.assignment.assignedByName = assignedByName || ''
      doc.assignment.assignedAt = new Date()
      doc.assignment.notes = notes || ''

      doc.assignment.driverAck = 'PENDING'
      doc.assignment.messengerAck = 'PENDING'
      doc.assignment.driverAckAt = undefined
      doc.assignment.messengerAckAt = undefined

      if (role === 'MESSENGER') {
        doc.assignment.messengerId = ''
        doc.assignment.messengerName = ''
      } else {
        doc.assignment.driverId = ''
        doc.assignment.driverName = ''
        doc.assignment.vehicleId = ''
        doc.assignment.vehicleName = ''
      }

      const st = String(doc.status || '').toUpperCase()
      if (!['COMPLETED', 'CANCELLED'].includes(st)) doc.status = 'PENDING'

      await doc.save()

      broadcastCarBooking(
        io,
        doc,
        'carBooking:assigned',
        shape.assigned(doc, {
          prevAssigneeId,
          prevAssigneeName,
          prevRole: role,
          action: 'UNASSIGN',
        })
      )
      broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

      try {
        await notify('ASSIGNMENT_UNASSIGNED', {
          bookingId: doc._id,
          prevAssigneeId,
          byName: req.user?.name || assignedByName || 'Admin',
        })
      } catch {}

      return res.json(doc)
    }

    const currentStatus = String(doc.status || '').toUpperCase()
    if (['COMPLETED', 'CANCELLED'].includes(currentStatus)) {
      throw createError(400, `Cannot assign when status is ${currentStatus}.`)
    }

    let resolvedName = incomingName
    if (!resolvedName && User) {
      const u = await User.findOne({ loginId: incomingId }).lean()
      if (u?.name) resolvedName = u.name
    }

    const s = toMinutes(doc.timeStart)
    const e = toMinutes(doc.timeEnd)

    const conflictField =
      role === 'MESSENGER' ? 'assignment.messengerId' : 'assignment.driverId'

    const conflictQuery = {
      _id: { $ne: doc._id },
      tripDate: doc.tripDate,
      status: { $nin: NON_BLOCKING_STATUSES },
      [conflictField]: incomingId,
    }

    const others = await CarBooking.find(conflictQuery).lean()
    const hasConflict = others.some((b) =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    )

    if (hasConflict) {
      const label = role === 'MESSENGER' ? 'Messenger' : 'Driver'
      return res.status(409).json({ message: `${label} already assigned during this time.` })
    }

    if (!doc.assignment) doc.assignment = {}

    doc.assignment.driverAck = 'PENDING'
    doc.assignment.messengerAck = 'PENDING'
    doc.assignment.driverAckAt = undefined
    doc.assignment.messengerAckAt = undefined

    doc.assignment.assignedById = assignedById || ''
    doc.assignment.assignedByName = assignedByName || ''
    doc.assignment.assignedAt = new Date()
    doc.assignment.notes = notes || ''

    if (role === 'MESSENGER') {
      doc.assignment.messengerId = incomingId
      doc.assignment.messengerName = resolvedName || ''
    } else {
      doc.assignment.driverId = incomingId
      doc.assignment.driverName = resolvedName || ''
      doc.assignment.vehicleId = vehicleId || ''
      doc.assignment.vehicleName = vehicleName || ''
    }

    if (autoAccept) doc.status = 'ACCEPTED'

    await doc.save()

    const sameAsBefore = String(prevAssigneeId || '').toLowerCase() === incomingId
    const action = sameAsBefore ? 'ASSIGN' : (prevAssigneeId ? 'REASSIGN' : 'ASSIGN')

    broadcastCarBooking(
      io,
      doc,
      'carBooking:assigned',
      shape.assigned(doc, {
        prevAssigneeId,
        prevAssigneeName,
        prevRole: role,
        action,
      })
    )
    broadcastCarBooking(io, doc, 'carBooking:status', shape.status(doc))

    try {
      await notify('ADMIN_ACCEPTED_ASSIGNED', {
        bookingId: doc._id,
        byName: req.user?.name || assignedByName || 'System',
        prevAssigneeId,
      })
    } catch {}

    res.json(doc)
  } catch (err) {
    console.error('[assignBooking error]', err)
    next(err)
  }
}

/**
 * ✅ ADMIN LIST (date range + filters)
 * Query supports:
 * - dateFrom/dateTo (preferred)
 * - date (single day fallback)
 * - status, category, q
 */
async function listAdmin(req, res, next) {
  try {
    const { date, dateFrom, dateTo, status, category, q } = req.query || {}
    const filter = buildRangeFilter({ date, dateFrom, dateTo, status, category, q })

    const list = await CarBooking.find(filter)
      .sort({ tripDate: 1, timeStart: 1 })
      .lean()

    res.json(list)
  } catch (err) { next(err) }
}

/* ───────── LIST FOR ASSIGNEE ───────── */
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
      filter.employeeId = driverId
    }

    if (date) filter.tripDate = date
    if (status && status !== 'ALL') filter.status = status

    const list = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    res.json(list)
  } catch (err) {
    console.error('[listForAssignee error]', err)
    next(err)
  }
}

/* ───────── DRIVER ACK ───────── */
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

/* ───────── UPDATE BOOKING ───────── */
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

    if (!isValidDate(doc.tripDate)) throw createError(400, 'Invalid tripDate (YYYY-MM-DD).')
    if (!['Car', 'Messenger'].includes(doc.category)) throw createError(400, 'Invalid category.')

    const s = toMinutes(doc.timeStart)
    const e = toMinutes(doc.timeEnd)

    const reservedQuery = buildReservedQuery({
      tripDate: doc.tripDate,
      category: doc.category,
      excludeId: doc._id,
    })

    const reserved = await CarBooking.find(reservedQuery).lean()
    const overlapping = reserved.filter((b) =>
      overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
    ).length

    const max = doc.category === 'Car' ? MAX_CAR : MAX_MSGR
    if (overlapping >= max) {
      throw createError(
        409,
        `No ${doc.category.toLowerCase()} available for ${doc.tripDate} ${doc.timeStart}-${doc.timeEnd}.`
      )
    }

    const ass = doc.assignment || {}

    if (ass.driverId) {
      const others = await CarBooking.find({
        _id: { $ne: doc._id },
        tripDate: doc.tripDate,
        status: { $nin: NON_BLOCKING_STATUSES },
        'assignment.driverId': ass.driverId,
      }).lean()

      const hasConflict = others.some((b) =>
        overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
      )
      if (hasConflict) throw createError(409, 'Driver already assigned during this time.')
    }

    if (ass.messengerId) {
      const othersM = await CarBooking.find({
        _id: { $ne: doc._id },
        tripDate: doc.tripDate,
        status: { $nin: ['CANCELLED'] },
        'assignment.messengerId': ass.messengerId,
      }).lean()

      const hasConflictM = othersM.some((b) =>
        overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))
      )
      if (hasConflictM) throw createError(409, 'Messenger already assigned during this time.')
    }

    await doc.save()

    broadcastCarBooking(io, doc, 'carBooking:updated', shape.updated(doc))

    try { await notify('REQUEST_UPDATED', { bookingId: doc._id }) } catch {}

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

    try { await notify('REQUEST_DELETED', { bookingId: doc._id }) } catch {}

    res.json({ ok: true })
  } catch (err) { next(err) }
}

/* ───────── MESSENGER ACK ───────── */
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

/* ───────── MESSENGER STATUS ───────── */
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

async function listMessengerTasks(req, res, next) {
  try {
    const messengerId =
      String(req.query.messengerId || req.query.loginId || req.headers['x-login-id'] || req.user?.loginId || '').trim()

    if (!messengerId) return res.status(400).json({ message: 'messengerId missing' })

    const filter = {
      $or: [
        { category: 'Messenger', 'assignment.messengerId': messengerId },
        { category: 'Car', 'assignment.messengerId': messengerId },
      ],
    }

    if (req.query.date) filter.tripDate = String(req.query.date)
    if (req.query.status && req.query.status !== 'ALL') filter.status = String(req.query.status).toUpperCase()

    const rows = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    // ✅ IMPORTANT: empty list is NOT an error
    return res.json(rows || [])
  } catch (err) {
    next(err)
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
  exportAdminExcel,
}
