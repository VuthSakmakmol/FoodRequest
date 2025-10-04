// backend/controllers/carBooking.controller.js
const createError = require('http-errors')
const CarBooking = require('../models/CarBooking')

// Try both names; fall back to null if none found.
let Employee = null
try { Employee = require('../models/Employee') } catch (e) {
  try { Employee = require('../models/EmployeeDirectory') } catch (_) {
    Employee = null
  }
}

const { toMinutes, overlaps, isValidDate } = require('../utils/time')

const MAX_CAR = 3
const MAX_MSGR = 1

function parsePayload(req) {
  if (req.file) {
    if (!req.body?.data) throw createError(400, 'Missing "data" field in multipart form.')
    try { return JSON.parse(req.body.data) } catch { throw createError(400, 'Invalid JSON in "data".') }
  }
  return req.body || {}
}

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
      return res.status(409).json({ message: `No ${category.toLowerCase()} available for ${tripDate} ${timeStart}-${timeEnd}. Please choose a different time or contact Admin.` })
    }

    let employeeSnapshot = { employeeId, name:'', department:'', contactNumber:'' }
    if (Employee) {
      const emp = await Employee.findOne({ employeeId }).lean()
      if (emp) employeeSnapshot = { employeeId: emp.employeeId, name: emp.name || '', department: emp.department || '', contactNumber: emp.contactNumber || '' }
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

    req.io?.emit('carBooking:created', { _id: String(doc._id), employeeId, category, tripDate, timeStart, timeEnd, status: doc.status })
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

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body || {}
    const allowed = ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']
    if (!allowed.includes(status)) throw createError(400, 'Invalid status.')
    const doc = await CarBooking.findByIdAndUpdate(id, { status }, { new: true })
    if (!doc) throw createError(404, 'Booking not found.')
    req.io?.emit('carBooking:status', { bookingId: String(doc._id), status, message: `Status updated: ${status}` })
    res.json(doc)
  } catch (err) { next(err) }
}

async function assignBooking(req, res, next) {
  try {
    const { id } = req.params
    const { driverId='', driverName='', vehicleId='', vehicleName='', notes='', assignedById='', assignedByName='', autoAccept=true } = req.body || {}

    const update = {
      assignment: { driverId, driverName, vehicleId, vehicleName, notes, assignedById, assignedByName, assignedAt: new Date() }
    }
    if (autoAccept) update.status = 'ACCEPTED'

    const doc = await CarBooking.findByIdAndUpdate(id, update, { new: true })
    if (!doc) throw createError(404, 'Booking not found.')
    req.io?.emit('carBooking:status', { bookingId: String(doc._id), status: doc.status, message: `Assigned to ${driverName || 'driver'}${vehicleName ? ` / ${vehicleName}` : ''}` })
    res.json(doc)
  } catch (err) { next(err) }
}

async function listAdmin(req, res, next) {
  try {
    const { date, status } = req.query
    const filter = {}
    if (date) { if (!isValidDate(date)) throw createError(400, 'Invalid date.'); filter.tripDate = date }
    if (status) filter.status = status
    const list = await CarBooking.find(filter).sort({ tripDate: 1, timeStart: 1 }).lean()
    res.json(list)
  } catch (err) { next(err) }
}

module.exports = { checkAvailability, createBooking, listMyBookings, updateStatus, assignBooking, listAdmin }
