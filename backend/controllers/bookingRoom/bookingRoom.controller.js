// backend/controllers/bookingRoom/bookingRoom.controller.js
const createError = require('http-errors')
const XLSX = require('xlsx')

const BookingRoom = require('../../models/bookingRoom/BookingRoom')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

let User = null
try { User = require('../../models/User') } catch { User = null }

const ROOM_NAMES = ['Dark Room', 'Apsara Room', 'Angkor Room']
const MATERIAL_TYPES = ['PROJECTOR', 'TV']

const ROOM_NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED', 'NOT_REQUIRED']
const MATERIAL_NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED', 'NOT_REQUIRED']
const OVERALL_NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED']

/* ─────────────────────────────────────────────
 * helpers
 * ───────────────────────────────────────────── */
function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function arr(v) {
  return Array.isArray(v) ? v : []
}

function isValidDate(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(ymd))
}

function isValidTime(hhmm) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s(hhmm))
}

function toMinutes(hhmm) {
  const [h, m] = s(hhmm).split(':').map(Number)
  return (h * 60) + m
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA
}

function uniqUpperStrings(a = []) {
  return [...new Set(arr(a).map((v) => up(v)).filter(Boolean))]
}

function nowPPDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
}

function pickIdentityFrom(req) {
  const loginId =
    req.user?.loginId ||
    req.headers['x-login-id'] ||
    req.query?.loginId ||
    req.body?.loginId ||
    ''

  const name =
    req.user?.name ||
    req.headers['x-user-name'] ||
    req.body?.actorName ||
    ''

  const roles = Array.isArray(req.user?.roles)
    ? req.user.roles.map(up).filter(Boolean)
    : []

  const roleOne = req.user?.role ? [up(req.user.role)] : []
  const mergedRoles = [...new Set([...roles, ...roleOne])]

  return {
    loginId: s(loginId),
    name: s(name),
    roles: mergedRoles,
  }
}

function canRoomAdmin(req) {
  const { roles } = pickIdentityFrom(req)
  return roles.includes('ROOM_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
}

function canMaterialAdmin(req) {
  const { roles } = pickIdentityFrom(req)
  return roles.includes('MATERIAL_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
}

function canAdminView(req) {
  const { roles } = pickIdentityFrom(req)
  return roles.some((r) =>
    ['ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'].includes(r)
  )
}

function normalizeRoomName(v) {
  const raw = s(v)
  const found = ROOM_NAMES.find((x) => up(x) === up(raw))
  return found || raw
}

function normalizeMaterials(v) {
  return uniqUpperStrings(v).filter((m) => MATERIAL_TYPES.includes(m))
}

function shapeCreated(doc) {
  return {
    bookingId: String(doc._id),
    _id: String(doc._id),
    employeeId: doc.employeeId,
    employee: doc.employee || null,
    bookingDate: doc.bookingDate,
    timeStart: doc.timeStart,
    timeEnd: doc.timeEnd,
    meetingTitle: doc.meetingTitle || '',
    purpose: doc.purpose || '',
    participantEstimate: doc.participantEstimate || 1,
    requirementNote: doc.requirementNote || '',
    roomRequired: !!doc.roomRequired,
    roomName: doc.roomName || '',
    materialRequired: !!doc.materialRequired,
    materials: doc.materials || [],
    roomStatus: doc.roomStatus,
    materialStatus: doc.materialStatus,
    overallStatus: doc.overallStatus,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function shapeUpdated(doc) {
  return {
    bookingId: String(doc._id),
    patch: {
      bookingDate: doc.bookingDate,
      timeStart: doc.timeStart,
      timeEnd: doc.timeEnd,
      meetingTitle: doc.meetingTitle || '',
      purpose: doc.purpose || '',
      participantEstimate: doc.participantEstimate || 1,
      requirementNote: doc.requirementNote || '',
      roomRequired: !!doc.roomRequired,
      roomName: doc.roomName || '',
      materialRequired: !!doc.materialRequired,
      materials: doc.materials || [],
      roomStatus: doc.roomStatus,
      materialStatus: doc.materialStatus,
      overallStatus: doc.overallStatus,
      updatedAt: doc.updatedAt,
    },
  }
}

function shapeStatus(doc) {
  return {
    bookingId: String(doc._id),
    roomStatus: doc.roomStatus,
    materialStatus: doc.materialStatus,
    overallStatus: doc.overallStatus,
  }
}

function emitBookingRoom(req, event, payload) {
  try {
    const io = req.io
    if (!io) return
    io.emit(event, payload)
  } catch {}
}

async function notifySafe(_type, _payload) {
  // Placeholder for future Telegram/email integration
  // Intentionally quiet for now to avoid breaking runtime if service not ready.
  return
}

function deriveOverallStatus(doc) {
  const roomRequired = !!doc.roomRequired
  const materialRequired = !!doc.materialRequired

  const roomStatus = up(doc.roomStatus)
  const materialStatus = up(doc.materialStatus)

  if (up(doc.overallStatus) === 'CANCELLED') return 'CANCELLED'

  const active = []
  if (roomRequired) active.push(roomStatus)
  if (materialRequired) active.push(materialStatus)

  if (!active.length) return 'PENDING'

  const allApproved = active.every((x) => x === 'APPROVED')
  if (allApproved) return 'APPROVED'

  const allRejected = active.every((x) => x === 'REJECTED')
  if (allRejected) return 'REJECTED'

  const hasApproved = active.some((x) => x === 'APPROVED')
  if (hasApproved) return 'PARTIAL_APPROVED'

  return 'PENDING'
}

function validateBasePayload(payload) {
  const bookingDate = s(payload.bookingDate)
  const timeStart = s(payload.timeStart)
  const timeEnd = s(payload.timeEnd)

  if (!isValidDate(bookingDate)) throw createError(400, 'Invalid bookingDate (YYYY-MM-DD).')
  if (!isValidTime(timeStart) || !isValidTime(timeEnd)) {
    throw createError(400, 'timeStart and timeEnd are required in HH:MM format.')
  }

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)
  if (endMin <= startMin) throw createError(400, 'timeEnd must be after timeStart.')
}

function normalizeRequestPayload(payload) {
  const roomRequired = !!payload.roomRequired
  const materialRequired = !!payload.materialRequired

  const roomName = roomRequired ? normalizeRoomName(payload.roomName) : ''
  const materials = materialRequired ? normalizeMaterials(payload.materials) : []

  if (!roomRequired && !materialRequired) {
    throw createError(400, 'At least one of roomRequired or materialRequired must be true.')
  }

  if (roomRequired && !roomName) {
    throw createError(400, 'roomName is required when roomRequired is true.')
  }

  if (materialRequired && !materials.length) {
    throw createError(400, 'At least one material is required when materialRequired is true.')
  }

  return {
    bookingDate: s(payload.bookingDate),
    timeStart: s(payload.timeStart),
    timeEnd: s(payload.timeEnd),

    meetingTitle: s(payload.meetingTitle),
    purpose: s(payload.purpose || ''),
    participantEstimate: Number(payload.participantEstimate || 1),
    requirementNote: s(payload.requirementNote),

    roomRequired,
    roomName,

    materialRequired,
    materials,
  }
}

/* Approved room booking blocks same room + overlapping time */
async function assertRoomApprovalConflict({ bookingDate, timeStart, timeEnd, roomName, excludeId = null }) {
  if (!roomName) return

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)

  const query = {
    bookingDate,
    roomRequired: true,
    roomName,
    roomStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd roomName roomStatus overallStatus')
    .lean()

  const conflicted = rows.some((row) =>
    overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
  )

  if (conflicted) {
    throw createError(409, `Room "${roomName}" is already approved for this time slot.`)
  }
}

/* Approved material booking blocks same material + overlapping time */
async function assertMaterialApprovalConflict({ bookingDate, timeStart, timeEnd, materials = [], excludeId = null }) {
  const wants = normalizeMaterials(materials)
  if (!wants.length) return

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)

  const query = {
    bookingDate,
    materialRequired: true,
    materials: { $in: wants },
    materialStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd materials materialStatus overallStatus')
    .lean()

  for (const row of rows) {
    const timeConflict = overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
    if (!timeConflict) continue

    const approvedMaterials = normalizeMaterials(row.materials)
    const sameMaterial = approvedMaterials.some((m) => wants.includes(m))
    if (sameMaterial) {
      throw createError(409, `One or more requested materials are already approved for this time slot.`)
    }
  }
}

function buildAdminFilter({ date, dateFrom, dateTo, overallStatus, roomStatus, materialStatus, q }) {
  const filter = {}

  const single = s(date)
  const from = s(dateFrom)
  const to = s(dateTo)

  if (from || to) {
    if (from && !isValidDate(from)) throw createError(400, 'Invalid dateFrom (YYYY-MM-DD).')
    if (to && !isValidDate(to)) throw createError(400, 'Invalid dateTo (YYYY-MM-DD).')

    const f = from || to
    const t = to || from
    if (f > t) throw createError(400, 'dateFrom must be <= dateTo.')

    filter.bookingDate = { $gte: f, $lte: t }
  } else if (single) {
    if (!isValidDate(single)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
    filter.bookingDate = single
  }

  if (overallStatus && overallStatus !== 'ALL') filter.overallStatus = up(overallStatus)
  if (roomStatus && roomStatus !== 'ALL') filter.roomStatus = up(roomStatus)
  if (materialStatus && materialStatus !== 'ALL') filter.materialStatus = up(materialStatus)

  const term = s(q)
  if (term) {
    filter.$or = [
      { employeeId: new RegExp(term, 'i') },
      { 'employee.name': new RegExp(term, 'i') },
      { 'employee.department': new RegExp(term, 'i') },
      { 'employee.position': new RegExp(term, 'i') },
      { meetingTitle: new RegExp(term, 'i') },
      { purpose: new RegExp(term, 'i') },
      { requirementNote: new RegExp(term, 'i') },
      { roomName: new RegExp(term, 'i') },
      { materials: new RegExp(term, 'i') },
    ]
  }

  return filter
}

function parseEmployeeId(req, payload = {}) {
  return s(
    payload.employeeId ||
    req.body?.employeeId ||
    req.query?.employeeId ||
    req.headers['x-employee-id'] ||
    req.user?.employeeId ||
    ''
  )
}

async function buildEmployeeSnapshot(employeeId) {
  const emp = await EmployeeDirectory.findOne({ employeeId: s(employeeId) }).lean()
  if (!emp) throw createError(404, 'Employee not found in EmployeeDirectory.')

  return {
    employeeId: s(emp.employeeId),
    name: s(emp.name),
    department: s(emp.department),
    position: s(emp.position),
    contactNumber: s(emp.contactNumber),
  }
}

/* ─────────────────────────────────────────────
 * public create
 * ───────────────────────────────────────────── */
async function createBooking(req, res, next) {
  try {
    const payload = req.body || {}
    const employeeId = parseEmployeeId(req, payload)
    if (!employeeId) throw createError(400, 'employeeId is required.')

    validateBasePayload(payload)
    const normalized = normalizeRequestPayload(payload)

    const employeeSnapshot = await buildEmployeeSnapshot(employeeId)

    // At request creation, do not block by pending items.
    // But if some resource is ALREADY APPROVED, new request cannot use that same slot.
    if (normalized.roomRequired) {
      await assertRoomApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomName: normalized.roomName,
      })
    }

    if (normalized.materialRequired) {
      await assertMaterialApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        materials: normalized.materials,
      })
    }

    const doc = await BookingRoom.create({
      employeeId,
      employee: employeeSnapshot,

      bookingDate: normalized.bookingDate,
      timeStart: normalized.timeStart,
      timeEnd: normalized.timeEnd,

      meetingTitle: normalized.meetingTitle,
      purpose: normalized.purpose,
      participantEstimate: normalized.participantEstimate,
      requirementNote: normalized.requirementNote,

      roomRequired: normalized.roomRequired,
      roomName: normalized.roomName,

      materialRequired: normalized.materialRequired,
      materials: normalized.materials,

      roomStatus: normalized.roomRequired ? 'PENDING' : 'NOT_REQUIRED',
      materialStatus: normalized.materialRequired ? 'PENDING' : 'NOT_REQUIRED',
      overallStatus: 'PENDING',

      submittedVia: 'PUBLIC_FORM',
    })

    doc.overallStatus = deriveOverallStatus(doc)
    await doc.save()

    emitBookingRoom(req, 'bookingRoom:created', shapeCreated(doc))
    await notifySafe('BOOKING_ROOM_CREATED', { bookingId: doc._id })

    return res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * public schedule
 * ───────────────────────────────────────────── */
async function listSchedulePublic(req, res, next) {
  try {
    const { date, roomName, material, showPending } = req.query || {}
    const filter = {}

    if (date) {
      if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
      filter.bookingDate = s(date)
    }

    if (s(roomName)) filter.roomName = normalizeRoomName(roomName)

    if (s(material)) filter.materials = up(material)

    // Public schedule should mainly show approved/partially-approved items.
    // Optionally allow pending for internal testing with showPending=true.
    if (String(showPending || '').toLowerCase() === 'true') {
      filter.overallStatus = { $ne: 'CANCELLED' }
    } else {
      filter.$or = [
        { roomStatus: 'APPROVED' },
        { materialStatus: 'APPROVED' },
      ]
      filter.overallStatus = { $ne: 'CANCELLED' }
    }

    const rows = await BookingRoom.find(filter)
      .sort({ bookingDate: 1, timeStart: 1, roomName: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * requester my list
 * ───────────────────────────────────────────── */
async function listMyBookings(req, res, next) {
  try {
    const employeeId = parseEmployeeId(req)
    if (!employeeId) throw createError(400, 'employeeId is required.')

    const rows = await BookingRoom.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * requester update before any approval
 * ───────────────────────────────────────────── */
async function updateBooking(req, res, next) {
  try {
    const { id } = req.params
    const payload = req.body || {}
    const employeeId = parseEmployeeId(req, payload)
    if (!employeeId) throw createError(400, 'employeeId is required.')

    const doc = await BookingRoom.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (s(doc.employeeId) !== employeeId) {
      throw createError(403, 'Not allowed: not your booking.')
    }

    if (typeof doc.canRequesterEditOrCancel === 'function') {
      if (!doc.canRequesterEditOrCancel()) {
        throw createError(400, 'This request can no longer be edited.')
      }
    } else {
      if (up(doc.roomStatus) === 'APPROVED' || up(doc.materialStatus) === 'APPROVED') {
        throw createError(400, 'This request can no longer be edited.')
      }
    }

    validateBasePayload(payload)
    const normalized = normalizeRequestPayload(payload)

    // approved schedule/resources must still be protected
    if (normalized.roomRequired) {
      await assertRoomApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomName: normalized.roomName,
        excludeId: doc._id,
      })
    }

    if (normalized.materialRequired) {
      await assertMaterialApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        materials: normalized.materials,
        excludeId: doc._id,
      })
    }

    doc.bookingDate = normalized.bookingDate
    doc.timeStart = normalized.timeStart
    doc.timeEnd = normalized.timeEnd
    doc.meetingTitle = normalized.meetingTitle
    doc.purpose = normalized.purpose
    doc.participantEstimate = normalized.participantEstimate
    doc.requirementNote = normalized.requirementNote

    doc.roomRequired = normalized.roomRequired
    doc.roomName = normalized.roomName
    doc.materialRequired = normalized.materialRequired
    doc.materials = normalized.materials

    doc.roomStatus = normalized.roomRequired ? 'PENDING' : 'NOT_REQUIRED'
    doc.materialStatus = normalized.materialRequired ? 'PENDING' : 'NOT_REQUIRED'
    doc.overallStatus = deriveOverallStatus(doc)

    doc.roomApproval = normalized.roomRequired
      ? { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }
      : { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }

    doc.materialApproval = normalized.materialRequired
      ? { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }
      : { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }

    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, 'bookingRoom:updated', shapeUpdated(doc))
    await notifySafe('BOOKING_ROOM_UPDATED', { bookingId: doc._id })

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * requester cancel before any approval
 * ───────────────────────────────────────────── */
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params
    const payload = req.body || {}
    const employeeId = parseEmployeeId(req, payload)
    const cancelReason = s(payload.cancelReason)

    if (!employeeId) throw createError(400, 'employeeId is required.')

    const doc = await BookingRoom.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (s(doc.employeeId) !== employeeId) {
      throw createError(403, 'Not allowed: not your booking.')
    }

    if (up(doc.overallStatus) === 'CANCELLED') {
      throw createError(400, 'Booking already cancelled.')
    }

    if (typeof doc.canRequesterEditOrCancel === 'function') {
      if (!doc.canRequesterEditOrCancel()) {
        throw createError(400, 'This request can no longer be cancelled.')
      }
    } else {
      if (up(doc.roomStatus) === 'APPROVED' || up(doc.materialStatus) === 'APPROVED') {
        throw createError(400, 'This request can no longer be cancelled.')
      }
    }

    if (doc.bookingDate < nowPPDate()) {
      throw createError(400, 'Cannot cancel a past booking.')
    }

    doc.overallStatus = 'CANCELLED'
    doc.cancelReason = cancelReason
    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, 'bookingRoom:status', shapeStatus(doc))
    await notifySafe('BOOKING_ROOM_CANCELLED', { bookingId: doc._id })

    return res.json({ ok: true, overallStatus: doc.overallStatus })
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * room admin list
 * ───────────────────────────────────────────── */
async function listRoomInbox(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { scope = 'ACTIONABLE' } = req.query || {}

    const filter = { roomRequired: true }

    if (up(scope) === 'ALL') {
      filter.roomStatus = { $in: ['PENDING', 'APPROVED', 'REJECTED'] }
      filter.overallStatus = { $ne: 'CANCELLED' }
    } else {
      filter.roomStatus = 'PENDING'
      filter.overallStatus = { $ne: 'CANCELLED' }
    }

    const rows = await BookingRoom.find(filter)
      .sort({ bookingDate: 1, timeStart: 1, createdAt: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * material admin list
 * ───────────────────────────────────────────── */
async function listMaterialInbox(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const { scope = 'ACTIONABLE' } = req.query || {}

    const filter = { materialRequired: true }

    if (up(scope) === 'ALL') {
      filter.materialStatus = { $in: ['PENDING', 'APPROVED', 'REJECTED'] }
      filter.overallStatus = { $ne: 'CANCELLED' }
    } else {
      filter.materialStatus = 'PENDING'
      filter.overallStatus = { $ne: 'CANCELLED' }
    }

    const rows = await BookingRoom.find(filter)
      .sort({ bookingDate: 1, timeStart: 1, createdAt: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * room decision
 * ───────────────────────────────────────────── */
async function roomDecision(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { decision, note = '' } = req.body || {}

    const normalizedDecision = up(decision)
    if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
      throw createError(400, 'decision must be APPROVED or REJECTED.')
    }

    const doc = await BookingRoom.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (!doc.roomRequired) throw createError(400, 'This booking does not require room approval.')
    if (up(doc.overallStatus) === 'CANCELLED') throw createError(400, 'Cancelled booking cannot be decided.')
    if (up(doc.roomStatus) !== 'PENDING') {
      throw createError(400, `Room decision already completed: ${doc.roomStatus}`)
    }

    if (normalizedDecision === 'APPROVED') {
      await assertRoomApprovalConflict({
        bookingDate: doc.bookingDate,
        timeStart: doc.timeStart,
        timeEnd: doc.timeEnd,
        roomName: doc.roomName,
        excludeId: doc._id,
      })
    }

    const actor = pickIdentityFrom(req)

    doc.roomStatus = normalizedDecision
    doc.roomApproval = {
      byLoginId: actor.loginId,
      byName: actor.name,
      decision: normalizedDecision,
      note: s(note),
      decidedAt: new Date(),
    }

    doc.overallStatus = deriveOverallStatus(doc)
    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, 'bookingRoom:status', shapeStatus(doc))
    await notifySafe('BOOKING_ROOM_ROOM_DECISION', {
      bookingId: doc._id,
      decision: normalizedDecision,
    })

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * material decision
 * ───────────────────────────────────────────── */
async function materialDecision(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { decision, note = '' } = req.body || {}

    const normalizedDecision = up(decision)
    if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
      throw createError(400, 'decision must be APPROVED or REJECTED.')
    }

    const doc = await BookingRoom.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (!doc.materialRequired) throw createError(400, 'This booking does not require material approval.')
    if (up(doc.overallStatus) === 'CANCELLED') throw createError(400, 'Cancelled booking cannot be decided.')
    if (up(doc.materialStatus) !== 'PENDING') {
      throw createError(400, `Material decision already completed: ${doc.materialStatus}`)
    }

    if (normalizedDecision === 'APPROVED') {
      await assertMaterialApprovalConflict({
        bookingDate: doc.bookingDate,
        timeStart: doc.timeStart,
        timeEnd: doc.timeEnd,
        materials: doc.materials,
        excludeId: doc._id,
      })
    }

    const actor = pickIdentityFrom(req)

    doc.materialStatus = normalizedDecision
    doc.materialApproval = {
      byLoginId: actor.loginId,
      byName: actor.name,
      decision: normalizedDecision,
      note: s(note),
      decidedAt: new Date(),
    }

    doc.overallStatus = deriveOverallStatus(doc)
    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, 'bookingRoom:status', shapeStatus(doc))
    await notifySafe('BOOKING_ROOM_MATERIAL_DECISION', {
      bookingId: doc._id,
      decision: normalizedDecision,
    })

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * admin list
 * ───────────────────────────────────────────── */
async function listAdmin(req, res, next) {
  try {
    if (!canAdminView(req)) throw createError(403, 'Forbidden')

    const filter = buildAdminFilter(req.query || {})

    const rows = await BookingRoom.find(filter)
      .sort({ bookingDate: 1, timeStart: 1, createdAt: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * admin export
 * ───────────────────────────────────────────── */
async function exportAdminExcel(req, res, next) {
  try {
    if (!canAdminView(req)) throw createError(403, 'Forbidden')

    const filter = buildAdminFilter(req.query || {})

    const rows = await BookingRoom.find(filter)
      .sort({ bookingDate: 1, timeStart: 1, createdAt: 1 })
      .lean()

    const data = (rows || []).map((b, idx) => ({
      No: idx + 1,
      BookingDate: s(b.bookingDate),
      TimeStart: s(b.timeStart),
      TimeEnd: s(b.timeEnd),
      EmployeeId: s(b.employeeId),
      EmployeeName: s(b.employee?.name),
      Department: s(b.employee?.department),
      Position: s(b.employee?.position),
      ContactNumber: s(b.employee?.contactNumber),

      MeetingTitle: s(b.meetingTitle),
      Purpose: s(b.purpose),
      ParticipantEstimate: Number(b.participantEstimate || 0),
      RequirementNote: s(b.requirementNote),

      RoomRequired: b.roomRequired ? 'YES' : 'NO',
      RoomName: s(b.roomName),
      RoomStatus: s(b.roomStatus),
      RoomDecisionBy: s(b.roomApproval?.byName) || s(b.roomApproval?.byLoginId),
      RoomDecision: s(b.roomApproval?.decision),
      RoomDecisionNote: s(b.roomApproval?.note),
      RoomDecidedAt: b.roomApproval?.decidedAt ? new Date(b.roomApproval.decidedAt).toISOString() : '',

      MaterialRequired: b.materialRequired ? 'YES' : 'NO',
      Materials: arr(b.materials).join(', '),
      MaterialStatus: s(b.materialStatus),
      MaterialDecisionBy: s(b.materialApproval?.byName) || s(b.materialApproval?.byLoginId),
      MaterialDecision: s(b.materialApproval?.decision),
      MaterialDecisionNote: s(b.materialApproval?.note),
      MaterialDecidedAt: b.materialApproval?.decidedAt ? new Date(b.materialApproval.decidedAt).toISOString() : '',

      OverallStatus: s(b.overallStatus),
      SubmittedVia: s(b.submittedVia),
      CancelReason: s(b.cancelReason),
      CreatedAt: b.createdAt ? new Date(b.createdAt).toISOString() : '',
      UpdatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : '',
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)

    ws['!cols'] = [
      { wch: 5 },  // No
      { wch: 12 }, // BookingDate
      { wch: 10 }, // TimeStart
      { wch: 10 }, // TimeEnd
      { wch: 14 }, // EmployeeId
      { wch: 24 }, // EmployeeName
      { wch: 18 }, // Department
      { wch: 18 }, // Position
      { wch: 16 }, // ContactNumber
      { wch: 24 }, // MeetingTitle
      { wch: 30 }, // Purpose
      { wch: 12 }, // ParticipantEstimate
      { wch: 30 }, // RequirementNote
      { wch: 12 }, // RoomRequired
      { wch: 20 }, // RoomName
      { wch: 14 }, // RoomStatus
      { wch: 20 }, // RoomDecisionBy
      { wch: 14 }, // RoomDecision
      { wch: 28 }, // RoomDecisionNote
      { wch: 24 }, // RoomDecidedAt
      { wch: 14 }, // MaterialRequired
      { wch: 22 }, // Materials
      { wch: 16 }, // MaterialStatus
      { wch: 20 }, // MaterialDecisionBy
      { wch: 16 }, // MaterialDecision
      { wch: 28 }, // MaterialDecisionNote
      { wch: 24 }, // MaterialDecidedAt
      { wch: 18 }, // OverallStatus
      { wch: 14 }, // SubmittedVia
      { wch: 24 }, // CancelReason
      { wch: 24 }, // CreatedAt
      { wch: 24 }, // UpdatedAt
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'BookingRoom')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="booking-room.xlsx"')
    return res.status(200).send(buf)
  } catch (err) {
    next(err)
  }
}

/* ─────────────────────────────────────────────
 * admin helper lists
 * ───────────────────────────────────────────── */
async function listRoomAdmins(_req, res, next) {
  try {
    if (!User) return res.json([])

    const rows = await User.find({
      isActive: true,
      roles: 'ROOM_ADMIN',
    })
      .select('loginId name role roles')
      .sort({ loginId: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

async function listMaterialAdmins(_req, res, next) {
  try {
    if (!User) return res.json([])

    const rows = await User.find({
      isActive: true,
      roles: 'MATERIAL_ADMIN',
    })
      .select('loginId name role roles')
      .sort({ loginId: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createBooking,
  listSchedulePublic,
  listMyBookings,
  updateBooking,
  cancelBooking,

  listRoomInbox,
  listMaterialInbox,
  roomDecision,
  materialDecision,

  listAdmin,
  exportAdminExcel,

  listRoomAdmins,
  listMaterialAdmins,
}