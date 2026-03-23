// backend/controllers/bookingRoom/bookingRoom.controller.js
const createError = require('http-errors')
const XLSX = require('xlsx')

const BookingRoom = require('../../models/bookingRoom/BookingRoom')
const BookingRoomResource = require('../../models/bookingRoom/BookingRoomResource')
const BookingRoomMaterial = require('../../models/bookingRoom/BookingRoomMaterial')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const {
  broadcastBookingRoomRequest,
  broadcastBookingRoomAvailability,
} = require('../../utils/bookingRoom.realtime')

/* ───────────────── notify (Telegram) ───────────────── */
let notify = null
try {
  notify = require('../../services/telegram/bookingRoom')
  console.log('✅ bookingRoom telegram notify loaded')
} catch (e) {
  console.warn('⚠️ bookingRoom telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') return
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ BookingRoom Telegram notify failed:', e?.response?.data || e?.message)
  }
}

const OVERALL_NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED']

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
  return h * 60 + m
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA
}

function safeId(v) {
  const raw = s(v)
  return raw || null
}

function materialItemsToText(items = []) {
  return arr(items)
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = Number(x?.qty || 0)
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
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

function canAdminView(req) {
  const { roles } = pickIdentityFrom(req)
  return roles.some((r) =>
    ['ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'].includes(r)
  )
}

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitBookingRoom(req, payload, event = 'bookingroom:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomRequest(io, payload, event)
  } catch (e) {
    console.warn('⚠️ booking room realtime emit failed:', e?.message)
  }
}

function emitBookingRoomAvailability(req, payload, event = 'bookingroom:availability:changed') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomAvailability(io, payload, event)
  } catch (e) {
    console.warn('⚠️ booking room availability realtime emit failed:', e?.message)
  }
}

async function notifySafe(type, payload = {}) {
  try {
    if (!notify) return

    const bookingId = s(payload?.bookingId)
    if (!bookingId) return

    const doc = await BookingRoom.findById(bookingId).lean()
    if (!doc) return

    const kind = up(type)

    if (kind === 'BOOKING_ROOM_CREATED') {
      await safeNotify(notify?.notifyBookingCreatedToEmployee, doc)
      await safeNotify(notify?.notifyCurrentApprover, doc)
      return
    }

    if (kind === 'BOOKING_ROOM_UPDATED') {
      await safeNotify(notify?.notifyBookingUpdatedToEmployee, doc)
      return
    }

    if (kind === 'BOOKING_ROOM_CANCELLED') {
      await safeNotify(notify?.notifyBookingCancelledToEmployee, doc)
      return
    }
  } catch (e) {
    console.warn('⚠️ notifySafe failed:', e?.message)
  }
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

async function findActiveRoomMaster({ roomId, roomCode, roomName }) {
  const conditions = []

  if (safeId(roomId)) conditions.push({ _id: safeId(roomId) })
  if (s(roomCode)) conditions.push({ code: up(roomCode) })
  if (s(roomName)) conditions.push({ name: s(roomName) })

  if (!conditions.length) return null

  const doc = await BookingRoomResource.findOne({
    isActive: true,
    $or: conditions,
  }).lean()

  return doc || null
}

async function findActiveMaterialMastersByCodes(codes = []) {
  const cleanCodes = [...new Set(arr(codes).map(up).filter(Boolean))]
  if (!cleanCodes.length) return []

  return BookingRoomMaterial.find({
    isActive: true,
    code: { $in: cleanCodes },
  }).lean()
}

function normalizeRawMaterialPayload(v) {
  const rawItems = arr(v)
  const out = []

  for (const item of rawItems) {
    if (typeof item === 'string') {
      const code = up(item)
      if (!code) continue
      out.push({
        materialId: null,
        materialCode: code,
        materialName: '',
        qty: 1,
      })
      continue
    }

    if (item && typeof item === 'object') {
      const code = up(item.materialCode || item.code || item.name)
      const qty = Number(item.qty || 0)

      if (!code) continue
      if (!Number.isFinite(qty) || qty <= 0) continue

      out.push({
        materialId: safeId(item.materialId || item._id),
        materialCode: code,
        materialName: s(item.materialName || item.name),
        qty,
      })
    }
  }

  const merged = new Map()
  for (const item of out) {
    const key = item.materialCode
    if (!merged.has(key)) {
      merged.set(key, { ...item })
    } else {
      const old = merged.get(key)
      old.qty += item.qty
      if (!old.materialId && item.materialId) old.materialId = item.materialId
      if (!old.materialName && item.materialName) old.materialName = item.materialName
    }
  }

  return [...merged.values()]
}

async function normalizeRequestPayload(payload) {
  const roomRequired = !!payload.roomRequired
  const materialRequired = !!payload.materialRequired

  if (!roomRequired && !materialRequired) {
    throw createError(400, 'At least one of roomRequired or materialRequired must be true.')
  }

  let room = {
    roomId: null,
    roomCode: '',
    roomName: '',
  }

  if (roomRequired) {
    const roomMaster = await findActiveRoomMaster({
      roomId: payload.roomId,
      roomCode: payload.roomCode,
      roomName: payload.roomName,
    })

    if (!roomMaster) {
      throw createError(400, 'Selected room does not exist or is inactive.')
    }

    room = {
      roomId: roomMaster._id,
      roomCode: up(roomMaster.code),
      roomName: s(roomMaster.name),
    }
  }

  let materials = []
  if (materialRequired) {
    const rawMaterials = normalizeRawMaterialPayload(payload.materials)

    if (!rawMaterials.length) {
      throw createError(400, 'At least one material is required when materialRequired is true.')
    }

    const codes = rawMaterials.map((x) => up(x.materialCode))
    const masters = await findActiveMaterialMastersByCodes(codes)
    const masterMap = new Map(masters.map((x) => [up(x.code), x]))

    materials = rawMaterials.map((item) => {
      const master = masterMap.get(up(item.materialCode))
      if (!master) {
        throw createError(400, `Material "${item.materialCode}" does not exist or is inactive.`)
      }

      const qty = Number(item.qty || 0)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw createError(400, `Material "${item.materialCode}" qty must be greater than 0.`)
      }

      if (qty > Number(master.totalQty || 0)) {
        throw createError(
          400,
          `Material "${s(master.name) || up(master.code)}" cannot exceed stock ${Number(master.totalQty || 0)}.`
        )
      }

      return {
        materialId: master._id,
        materialCode: up(master.code),
        materialName: s(master.name),
        qty,
      }
    })

    if (!materials.length) {
      throw createError(400, 'At least one material is required when materialRequired is true.')
    }
  }

  return {
    bookingDate: s(payload.bookingDate),
    timeStart: s(payload.timeStart),
    timeEnd: s(payload.timeEnd),

    meetingTitle: s(payload.meetingTitle),
    purpose: s(payload.purpose || ''),
    participantEstimate: Math.max(1, Number(payload.participantEstimate || 1)),
    requirementNote: s(payload.requirementNote),

    roomRequired,
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomName: room.roomName,
    room: room.roomId
      ? {
          roomId: room.roomId,
          roomCode: room.roomCode,
          roomName: room.roomName,
        }
      : null,

    materialRequired,
    materials,
  }
}

async function assertRoomApprovalConflict({
  bookingDate,
  timeStart,
  timeEnd,
  roomCode,
  excludeId = null,
}) {
  if (!s(roomCode)) return

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)

  const query = {
    bookingDate,
    roomRequired: true,
    roomCode: up(roomCode),
    roomStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd roomCode roomName roomStatus overallStatus')
    .lean()

  const conflicted = rows.some((row) =>
    overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
  )

  if (conflicted) {
    const roomLabel = s(rows[0]?.roomName) || s(roomCode)
    throw createError(409, `Room "${roomLabel}" is already approved for this time slot.`)
  }
}

async function assertMaterialApprovalConflict({
  bookingDate,
  timeStart,
  timeEnd,
  materials = [],
  excludeId = null,
}) {
  const wants = arr(materials)
    .map((x) => ({
      materialCode: up(x?.materialCode),
      qty: Number(x?.qty || 0),
    }))
    .filter((x) => x.materialCode && x.qty > 0)

  if (!wants.length) return

  const codes = wants.map((x) => x.materialCode)
  const masters = await findActiveMaterialMastersByCodes(codes)
  const masterMap = new Map(masters.map((x) => [up(x.code), x]))

  for (const want of wants) {
    if (!masterMap.has(want.materialCode)) {
      throw createError(400, `Material "${want.materialCode}" does not exist or is inactive.`)
    }

    const master = masterMap.get(want.materialCode)
    const stock = Number(master?.totalQty || 0)
    if (want.qty > stock) {
      throw createError(
        400,
        `Material "${s(master?.name) || want.materialCode}" cannot exceed stock ${stock}.`
      )
    }
  }

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)

  const query = {
    bookingDate,
    materialRequired: true,
    materialStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    'materials.materialCode': { $in: codes },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd materials materialStatus overallStatus')
    .lean()

  const usedMap = {}

  for (const row of rows) {
    const timeConflict = overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
    if (!timeConflict) continue

    for (const item of arr(row.materials)) {
      const code = up(item?.materialCode)
      const qty = Number(item?.qty || 0)
      if (!code || qty <= 0) continue
      usedMap[code] = (usedMap[code] || 0) + qty
    }
  }

  for (const want of wants) {
    const master = masterMap.get(want.materialCode)
    const totalQty = Number(master?.totalQty || 0)
    const usedQty = Number(usedMap[want.materialCode] || 0)
    const availableQty = Math.max(0, totalQty - usedQty)

    if (want.qty > availableQty) {
      throw createError(
        409,
        `Material "${s(master?.name) || want.materialCode}" only has ${availableQty} available for this time slot.`
      )
    }
  }
}

function buildAdminFilter({
  date,
  dateFrom,
  dateTo,
  overallStatus,
  roomStatus,
  materialStatus,
  q,
  roomCode,
  materialCode,
}) {
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
  if (s(roomCode)) filter.roomCode = up(roomCode)
  if (s(materialCode)) filter['materials.materialCode'] = up(materialCode)

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
      { roomCode: new RegExp(term, 'i') },
      { 'materials.materialName': new RegExp(term, 'i') },
      { 'materials.materialCode': new RegExp(term, 'i') },
    ]
  }

  return filter
}

async function getAvailability(req, res, next) {
  try {
    const { date, timeStart, timeEnd, excludeId = '' } = req.query || {}

    if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
    if (!isValidTime(timeStart) || !isValidTime(timeEnd)) {
      throw createError(400, 'timeStart and timeEnd are required in HH:MM format.')
    }
    if (toMinutes(timeEnd) <= toMinutes(timeStart)) {
      throw createError(400, 'timeEnd must be after timeStart.')
    }

    const startMin = toMinutes(timeStart)
    const endMin = toMinutes(timeEnd)

    const bookingQuery = {
      bookingDate: s(date),
      overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    }

    if (s(excludeId)) {
      bookingQuery._id = { $ne: s(excludeId) }
    }

    const [rooms, materials, bookings] = await Promise.all([
      BookingRoomResource.find({ isActive: true }).sort({ name: 1 }).lean(),
      BookingRoomMaterial.find({ isActive: true }).sort({ name: 1 }).lean(),
      BookingRoom.find(bookingQuery)
        .select(
          [
            'timeStart',
            'timeEnd',
            'roomRequired',
            'roomCode',
            'roomName',
            'roomStatus',
            'materialRequired',
            'materials',
            'materialStatus',
          ].join(' ')
        )
        .lean(),
    ])

    const overlapRows = bookings.filter((row) =>
      overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
    )

    const busyRoomCodes = new Set(
      overlapRows
        .filter((x) => x.roomRequired && up(x.roomStatus) === 'APPROVED' && s(x.roomCode))
        .map((x) => up(x.roomCode))
    )

    const usedMaterialMap = {}

    for (const row of overlapRows) {
      if (!row.materialRequired || up(row.materialStatus) !== 'APPROVED') continue

      for (const item of arr(row.materials)) {
        const code = up(item?.materialCode)
        const qty = Number(item?.qty || 0)
        if (!code || qty <= 0) continue
        usedMaterialMap[code] = Number(usedMaterialMap[code] || 0) + qty
      }
    }

    return res.json({
      date: s(date),
      timeStart: s(timeStart),
      timeEnd: s(timeEnd),
      excludeId: s(excludeId),

      rooms: rooms.map((r) => {
        const blocked = busyRoomCodes.has(up(r.code))

        return {
          _id: r._id,
          code: s(r.code),
          name: s(r.name),
          capacity: Number(r.capacity || 0),
          imageUrl: r.hasImage ? `/api/public/booking-room/rooms/${r._id}/image` : '',
          isAvailable: !blocked,
          status: blocked ? 'UNAVAILABLE' : 'AVAILABLE',
        }
      }),

      materials: materials.map((m) => {
        const code = up(m.code)
        const totalQty = Number(m.totalQty || 0)
        const usedQty = Number(usedMaterialMap[code] || 0)
        const availableQty = Math.max(0, totalQty - usedQty)

        return {
          _id: m._id,
          code: s(m.code),
          name: s(m.name),
          totalQty,
          usedQty,
          availableQty,
          isAvailable: availableQty > 0,
          status: availableQty > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        }
      }),
    })
  } catch (err) {
    next(err)
  }
}

async function createBooking(req, res, next) {
  try {
    const payload = req.body || {}
    const employeeId = parseEmployeeId(req, payload)
    if (!employeeId) throw createError(400, 'employeeId is required.')

    validateBasePayload(payload)
    const normalized = await normalizeRequestPayload(payload)
    const employeeSnapshot = await buildEmployeeSnapshot(employeeId)
    const actor = pickIdentityFrom(req)

    if (normalized.roomRequired) {
      await assertRoomApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomCode: normalized.roomCode,
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

      requesterLoginId: actor.loginId,
      createdByLoginId: actor.loginId,

      bookingDate: normalized.bookingDate,
      timeStart: normalized.timeStart,
      timeEnd: normalized.timeEnd,

      meetingTitle: normalized.meetingTitle,
      purpose: normalized.purpose,
      participantEstimate: normalized.participantEstimate,
      requirementNote: normalized.requirementNote,

      roomRequired: normalized.roomRequired,
      roomId: normalized.roomId,
      roomCode: normalized.roomCode,
      roomName: normalized.roomName,
      room: normalized.room,

      materialRequired: normalized.materialRequired,
      materials: normalized.materials,

      roomStatus: normalized.roomRequired ? 'PENDING' : 'NOT_REQUIRED',
      materialStatus: normalized.materialRequired ? 'PENDING' : 'NOT_REQUIRED',
      overallStatus: 'PENDING',

      submittedVia: 'PUBLIC_FORM',
    })

    doc.overallStatus = deriveOverallStatus(doc)
    await doc.save()

    emitBookingRoom(req, doc, 'bookingroom:req:created')
    emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
    await notifySafe('BOOKING_ROOM_CREATED', { bookingId: doc._id })

    return res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}

async function listSchedulePublic(req, res, next) {
  try {
    const { date, roomCode, roomName, material, showPending } = req.query || {}
    const filter = {}

    if (date) {
      if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).')
      filter.bookingDate = s(date)
    }

    if (s(roomCode)) filter.roomCode = up(roomCode)
    else if (s(roomName)) filter.roomName = s(roomName)

    if (s(material)) filter['materials.materialCode'] = up(material)

    if (String(showPending || '').toLowerCase() === 'true') {
      filter.overallStatus = { $ne: 'CANCELLED' }
    } else {
      filter.$or = [{ roomStatus: 'APPROVED' }, { materialStatus: 'APPROVED' }]
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
    } else if (up(doc.roomStatus) === 'APPROVED' || up(doc.materialStatus) === 'APPROVED') {
      throw createError(400, 'This request can no longer be edited.')
    }

    validateBasePayload(payload)
    const normalized = await normalizeRequestPayload(payload)

    if (normalized.roomRequired) {
      await assertRoomApprovalConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomCode: normalized.roomCode,
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

    if (!s(doc.requesterLoginId)) {
      const actor = pickIdentityFrom(req)
      doc.requesterLoginId = actor.loginId
      doc.createdByLoginId = doc.createdByLoginId || actor.loginId
    }

    doc.bookingDate = normalized.bookingDate
    doc.timeStart = normalized.timeStart
    doc.timeEnd = normalized.timeEnd
    doc.meetingTitle = normalized.meetingTitle
    doc.purpose = normalized.purpose
    doc.participantEstimate = normalized.participantEstimate
    doc.requirementNote = normalized.requirementNote

    doc.roomRequired = normalized.roomRequired
    doc.roomId = normalized.roomId
    doc.roomCode = normalized.roomCode
    doc.roomName = normalized.roomName
    doc.room = normalized.room

    doc.materialRequired = normalized.materialRequired
    doc.materials = normalized.materials

    doc.roomStatus = normalized.roomRequired ? 'PENDING' : 'NOT_REQUIRED'
    doc.materialStatus = normalized.materialRequired ? 'PENDING' : 'NOT_REQUIRED'
    doc.overallStatus = deriveOverallStatus(doc)

    doc.roomApproval = { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }
    doc.materialApproval = { byLoginId: '', byName: '', decision: '', note: '', decidedAt: null }

    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, doc, 'bookingroom:req:updated')
    emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
    await notifySafe('BOOKING_ROOM_UPDATED', { bookingId: doc._id })

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

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
    } else if (up(doc.roomStatus) === 'APPROVED' || up(doc.materialStatus) === 'APPROVED') {
      throw createError(400, 'This request can no longer be cancelled.')
    }

    const todayPP = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
    if (doc.bookingDate < todayPP) {
      throw createError(400, 'Cannot cancel a past booking.')
    }

    if (!s(doc.requesterLoginId)) {
      const actor = pickIdentityFrom(req)
      doc.requesterLoginId = actor.loginId
      doc.createdByLoginId = doc.createdByLoginId || actor.loginId
    }

    doc.overallStatus = 'CANCELLED'
    doc.cancelReason = cancelReason

    if (doc.roomRequired && up(doc.roomStatus) === 'PENDING') doc.roomStatus = 'REJECTED'
    if (doc.materialRequired && up(doc.materialStatus) === 'PENDING') doc.materialStatus = 'REJECTED'

    doc.updatedAt = new Date()
    await doc.save()

    emitBookingRoom(req, doc, 'bookingroom:req:updated')
    emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
    await notifySafe('BOOKING_ROOM_CANCELLED', { bookingId: doc._id })

    return res.json({ ok: true, overallStatus: doc.overallStatus })
  } catch (err) {
    next(err)
  }
}

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
      RoomCode: s(b.roomCode),
      RoomName: s(b.roomName),
      RoomStatus: s(b.roomStatus),
      RoomDecisionBy: s(b.roomApproval?.byName) || s(b.roomApproval?.byLoginId),
      RoomDecision: s(b.roomApproval?.decision),
      RoomDecisionNote: s(b.roomApproval?.note),
      RoomDecidedAt: b.roomApproval?.decidedAt
        ? new Date(b.roomApproval.decidedAt).toISOString()
        : '',

      MaterialRequired: b.materialRequired ? 'YES' : 'NO',
      Materials: materialItemsToText(b.materials),
      MaterialStatus: s(b.materialStatus),
      MaterialDecisionBy: s(b.materialApproval?.byName) || s(b.materialApproval?.byLoginId),
      MaterialDecision: s(b.materialApproval?.decision),
      MaterialDecisionNote: s(b.materialApproval?.note),
      MaterialDecidedAt: b.materialApproval?.decidedAt
        ? new Date(b.materialApproval.decidedAt).toISOString()
        : '',

      OverallStatus: s(b.overallStatus),
      SubmittedVia: s(b.submittedVia),
      CancelReason: s(b.cancelReason),
      CreatedAt: b.createdAt ? new Date(b.createdAt).toISOString() : '',
      UpdatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : '',
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)

    XLSX.utils.book_append_sheet(wb, ws, 'BookingRoom')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', 'attachment; filename="booking-room.xlsx"')
    return res.status(200).send(buf)
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
  listAdmin,
  exportAdminExcel,
  getAvailability,
}