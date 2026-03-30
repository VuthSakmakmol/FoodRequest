// backend/controllers/bookingRoom/roomAdmin.controller.js
const createError = require('http-errors')
const mongoose = require('mongoose')
const { Readable } = require('stream')

const BookingRoom = require('../../models/bookingRoom/BookingRoom')
const BookingRoomResource = require('../../models/bookingRoom/BookingRoomResource')

let User = null
try {
  User = require('../../models/User')
} catch {
  User = null
}

const {
  broadcastBookingRoomRequest,
  broadcastBookingRoomAvailability,
  broadcastBookingRoomMaster,
  broadcastBookingRoomMastersChanged,
} = require('../../utils/bookingRoom.realtime')

/* ───────────────── notify (Telegram) ───────────────── */
let notify = null
try {
  notify = require('../../services/telegram/bookingRoom')
  console.log('✅ RoomAdmin telegram notify loaded')
} catch (e) {
  console.warn('⚠️ RoomAdmin telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') return
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ RoomAdmin Telegram notify failed:', e?.response?.data || e?.message)
  }
}

const OVERALL_NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED']
const ROOM_IMAGE_BUCKET = 'booking_room_images'

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function toPositiveInt(v, fallback = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.floor(n))
}

function toBool(v, fallback = true) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return fallback
}

function normalizeWeeklyAvailability(payload = {}, fallback = null) {
  const base = fallback && typeof fallback === 'object'
    ? {
        mon: toBool(fallback.mon, true),
        tue: toBool(fallback.tue, true),
        wed: toBool(fallback.wed, true),
        thu: toBool(fallback.thu, true),
        fri: toBool(fallback.fri, true),
        sat: toBool(fallback.sat, true),
        sun: toBool(fallback.sun, true),
      }
    : {
        mon: true,
        tue: true,
        wed: true,
        thu: true,
        fri: true,
        sat: true,
        sun: true,
      }

  return {
    mon: payload.mon != null ? toBool(payload.mon, true) : base.mon,
    tue: payload.tue != null ? toBool(payload.tue, true) : base.tue,
    wed: payload.wed != null ? toBool(payload.wed, true) : base.wed,
    thu: payload.thu != null ? toBool(payload.thu, true) : base.thu,
    fri: payload.fri != null ? toBool(payload.fri, true) : base.fri,
    sat: payload.sat != null ? toBool(payload.sat, true) : base.sat,
    sun: payload.sun != null ? toBool(payload.sun, true) : base.sun,
  }
}

function weekdayKeyFromYMD(ymd) {
  const raw = s(ymd)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''

  const [year, month, day] = raw.split('-').map(Number)
  const jsDay = new Date(year, month - 1, day).getDay()

  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][jsDay] || ''
}

function isRoomAllowedOnDate(roomDoc, bookingDate) {
  const key = weekdayKeyFromYMD(bookingDate)
  if (!key) return true
  const wa = roomDoc?.weeklyAvailability || {}
  return wa[key] !== false
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

function nowPPDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
}

function slugRoomCodeFromName(name) {
  return up(name)
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
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

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitBookingRoom(req, payload, event = 'bookingroom:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomRequest(io, payload, event)
  } catch (e) {
    console.warn('⚠️ room realtime emit failed:', e?.message)
  }
}

function emitBookingRoomAvailability(req, payload, event = 'bookingroom:availability:changed') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomAvailability(io, payload, event)
  } catch (e) {
    console.warn('⚠️ room availability realtime emit failed:', e?.message)
  }
}

function emitBookingRoomMaster(req, payload, event = 'bookingroom:room-master:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomMaster(io, payload, event)
  } catch (e) {
    console.warn('⚠️ room master realtime emit failed:', e?.message)
  }
}

function emitBookingRoomMastersChanged(req, payload, event = 'bookingroom:masters:changed') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomMastersChanged(io, payload, event)
  } catch (e) {
    console.warn('⚠️ room masters changed realtime emit failed:', e?.message)
  }
}

function buildRoomImageApiUrl(roomId) {
  return `/api/booking-room/admin/rooms/${roomId}/image`
}

function getGridFSBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: ROOM_IMAGE_BUCKET,
  })
}

async function uploadRoomImageToGridFS(file, meta = {}) {
  if (!file?.buffer) return null

  const bucket = getGridFSBucket()
  const filename = `${s(meta.roomCode || 'ROOM')}_${Date.now()}_${s(file.originalname || 'image')}`

  return await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: s(file.mimetype) || 'application/octet-stream',
      metadata: {
        roomId: s(meta.roomId),
        roomCode: s(meta.roomCode),
        roomName: s(meta.roomName),
      },
    })

    Readable.from(file.buffer)
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve({
          fileId: uploadStream.id,
          filename,
          contentType: s(file.mimetype),
        })
      })
  })
}

async function deleteRoomImageFromGridFS(fileId) {
  try {
    if (!fileId) return
    const bucket = getGridFSBucket()
    const objId =
      typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId
    await bucket.delete(objId)
  } catch (e) {
    console.warn('⚠️ delete room image failed:', e?.message)
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

async function assertRoomApprovalConflict({ bookingDate, timeStart, timeEnd, roomCode, excludeId = null }) {
  const filter = {
    bookingDate: s(bookingDate),
    roomRequired: true,
    roomCode: up(roomCode),
    roomStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
  }

  if (excludeId) {
    filter._id = { $ne: excludeId }
  }

  const rows = await BookingRoom.find(filter)
    .select('timeStart timeEnd')
    .lean()

  const start = toMinutes(timeStart)
  const end = toMinutes(timeEnd)

  for (const row of rows || []) {
    const rowStart = toMinutes(row.timeStart)
    const rowEnd = toMinutes(row.timeEnd)
    if (overlaps(start, end, rowStart, rowEnd)) {
      throw createError(409, 'Room already approved for the selected time.')
    }
  }
}

async function assertRoomMasterCanDeactivate({ roomDoc, excludePast = true }) {
  const code = up(roomDoc?.code)
  if (!code) return

  const filter = {
    roomRequired: true,
    roomCode: code,
    roomStatus: { $in: ['PENDING', 'APPROVED'] },
    overallStatus: { $ne: 'CANCELLED' },
  }

  if (excludePast) {
    filter.bookingDate = { $gte: nowPPDate() }
  }

  const exists = await BookingRoom.exists(filter)
  if (exists) {
    throw createError(409, 'This room still has active or upcoming bookings.')
  }
}

async function listActiveRooms(req, res, next) {
  try {
    const rows = await BookingRoomResource.find({ isActive: true })
      .sort({ name: 1 })
      .lean()

    const mapped = (rows || []).map((row) => ({
      ...row,
      imageUrl: row.hasImage ? buildRoomImageApiUrl(row._id) : '',
    }))

    return res.json(mapped)
  } catch (err) {
    next(err)
  }
}

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

async function roomDecision(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { decision, note = '' } = req.body || {}

    const normalizedDecision = up(decision)
    if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
      throw createError(400, 'decision must be APPROVED or REJECTED.')
    }

    if (normalizedDecision === 'REJECTED' && !s(note)) {
      throw createError(400, 'Reject reason is required.')
    }

    const doc = await BookingRoom.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    if (!doc.roomRequired) throw createError(400, 'This booking does not require room approval.')
    if (up(doc.overallStatus) === 'CANCELLED') {
      throw createError(400, 'Cancelled booking cannot be decided.')
    }
    if (up(doc.roomStatus) !== 'PENDING') {
      throw createError(400, `Room decision already completed: ${doc.roomStatus}`)
    }

    if (normalizedDecision === 'APPROVED') {
      await assertRoomApprovalConflict({
        bookingDate: doc.bookingDate,
        timeStart: doc.timeStart,
        timeEnd: doc.timeEnd,
        roomCode: doc.roomCode,
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

    emitBookingRoom(req, doc, 'bookingroom:req:updated')
    emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
    await safeNotify(notify?.notifyRoomDecision, doc._id)

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

async function listRoomMasters(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { active = 'ALL', q = '' } = req.query || {}
    const filter = {}

    if (up(active) === 'ACTIVE') filter.isActive = true
    else if (up(active) === 'INACTIVE') filter.isActive = false

    const term = s(q)
    if (term) {
      filter.$or = [{ code: new RegExp(term, 'i') }, { name: new RegExp(term, 'i') }]
    }

    const rows = await BookingRoomResource.find(filter)
      .sort({ isActive: -1, name: 1 })
      .lean()

    const mapped = (rows || []).map((row) => ({
      ...row,
      imageUrl: row.hasImage ? buildRoomImageApiUrl(row._id) : '',
    }))

    return res.json(mapped)
  } catch (err) {
    next(err)
  }
}

async function createRoomMaster(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const payload = req.body || {}
    const name = s(payload.name)
    const capacity = toPositiveInt(payload.capacity, 1)
    const isActive = payload.isActive !== 'false' && payload.isActive !== false
    const weeklyAvailability = normalizeWeeklyAvailability(payload)

    if (!name) throw createError(400, 'name is required.')
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw createError(400, 'capacity must be at least 1.')
    }

    const code = slugRoomCodeFromName(name)
    if (!code) throw createError(400, 'Unable to generate room code from name.')

    const dup = await BookingRoomResource.findOne({
      $or: [{ code }, { name }],
    }).lean()

    if (dup) {
      throw createError(409, 'Room name already exists.')
    }

    let uploaded = null
    if (req.file?.buffer) {
      uploaded = await uploadRoomImageToGridFS(req.file, {
        roomCode: code,
        roomName: name,
      })
    }

    const doc = await BookingRoomResource.create({
      code,
      name,
      capacity,
      weeklyAvailability,
      imageFileId: uploaded?.fileId || null,
      imageFilename: uploaded?.filename || '',
      imageContentType: uploaded?.contentType || '',
      hasImage: !!uploaded?.fileId,
      isActive,
    })

    const roomJson = {
      ...doc.toObject(),
      imageUrl: doc.hasImage ? buildRoomImageApiUrl(doc._id) : '',
    }

    emitBookingRoomMaster(
      req,
      {
        _id: String(doc._id),
        type: 'ROOM',
        action: 'CREATED',
        room: roomJson,
      },
      'bookingroom:room-master:created'
    )

    emitBookingRoomMastersChanged(req, {
      _id: String(doc._id),
      type: 'ROOM',
      action: 'CREATED',
    })

    emitBookingRoomAvailability(
      req,
      {
        type: 'ROOM',
        action: 'CREATED',
        roomId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.status(201).json(roomJson)
  } catch (err) {
    next(err)
  }
}

async function updateRoomMaster(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const payload = req.body || {}

    const doc = await BookingRoomResource.findById(id)
    if (!doc) throw createError(404, 'Room not found.')

    const nextName = payload.name != null ? s(payload.name) : s(doc.name)
    const nextCapacity =
      payload.capacity != null ? toPositiveInt(payload.capacity, 1) : toPositiveInt(doc.capacity, 1)
    const nextIsActive =
      payload.isActive != null
        ? payload.isActive !== 'false' && payload.isActive !== false
        : !!doc.isActive
    const nextWeeklyAvailability = normalizeWeeklyAvailability(payload, doc.weeklyAvailability)

    if (!nextName) throw createError(400, 'name is required.')
    if (!Number.isFinite(nextCapacity) || nextCapacity < 1) {
      throw createError(400, 'capacity must be at least 1.')
    }

    const nextCode = slugRoomCodeFromName(nextName)
    if (!nextCode) throw createError(400, 'Unable to generate room code from name.')

    const dup = await BookingRoomResource.findOne({
      _id: { $ne: doc._id },
      $or: [{ code: nextCode }, { name: nextName }],
    }).lean()

    if (dup) {
      throw createError(409, 'Room name already exists.')
    }

    if (doc.isActive && !nextIsActive) {
      await assertRoomMasterCanDeactivate({
        roomDoc: doc,
        excludePast: true,
      })
    }

    const oldImageFileId = doc.imageFileId

    if (req.file?.buffer) {
      const uploaded = await uploadRoomImageToGridFS(req.file, {
        roomId: String(doc._id),
        roomCode: nextCode,
        roomName: nextName,
      })

      doc.imageFileId = uploaded?.fileId || null
      doc.imageFilename = uploaded?.filename || ''
      doc.imageContentType = uploaded?.contentType || ''
      doc.hasImage = !!uploaded?.fileId
    }

    if (payload.removeImage === 'true' || payload.removeImage === true) {
      doc.imageFileId = null
      doc.imageFilename = ''
      doc.imageContentType = ''
      doc.hasImage = false
    }

    doc.code = nextCode
    doc.name = nextName
    doc.capacity = nextCapacity
    doc.weeklyAvailability = nextWeeklyAvailability
    doc.isActive = nextIsActive

    await doc.save()

    if (req.file?.buffer && oldImageFileId && String(oldImageFileId) !== String(doc.imageFileId)) {
      await deleteRoomImageFromGridFS(oldImageFileId)
    }

    if ((payload.removeImage === 'true' || payload.removeImage === true) && oldImageFileId) {
      await deleteRoomImageFromGridFS(oldImageFileId)
    }

    const roomJson = {
      ...doc.toObject(),
      imageUrl: doc.hasImage ? buildRoomImageApiUrl(doc._id) : '',
    }

    emitBookingRoomMaster(
      req,
      {
        _id: String(doc._id),
        type: 'ROOM',
        action: 'UPDATED',
        room: roomJson,
      },
      'bookingroom:room-master:updated'
    )

    emitBookingRoomMastersChanged(req, {
      _id: String(doc._id),
      type: 'ROOM',
      action: 'UPDATED',
    })

    emitBookingRoomAvailability(
      req,
      {
        type: 'ROOM',
        action: 'UPDATED',
        roomId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.json(roomJson)
  } catch (err) {
    next(err)
  }
}

async function deleteRoomMaster(req, res, next) {
  try {
    if (!canRoomAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const doc = await BookingRoomResource.findById(id)
    if (!doc) throw createError(404, 'Room not found.')

    await assertRoomMasterCanDeactivate({
      roomDoc: doc,
      excludePast: true,
    })

    doc.isActive = false
    await doc.save()

    const roomJson = {
      ...doc.toObject(),
      imageUrl: doc.hasImage ? buildRoomImageApiUrl(doc._id) : '',
    }

    emitBookingRoomMaster(
      req,
      {
        _id: String(doc._id),
        type: 'ROOM',
        action: 'DELETED',
        room: roomJson,
      },
      'bookingroom:room-master:deleted'
    )

    emitBookingRoomMastersChanged(req, {
      _id: String(doc._id),
      type: 'ROOM',
      action: 'DELETED',
    })

    emitBookingRoomAvailability(
      req,
      {
        type: 'ROOM',
        action: 'DELETED',
        roomId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.json({ ok: true, _id: doc._id, isActive: doc.isActive })
  } catch (err) {
    next(err)
  }
}

async function streamRoomImage(req, res, next) {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw createError(400, 'Invalid room id.')
    }

    const room = await BookingRoomResource.findById(id)
      .select('imageFileId imageFilename imageContentType hasImage isActive')
      .lean()

    if (!room) throw createError(404, 'Room not found.')
    if (!room.hasImage || !room.imageFileId) throw createError(404, 'Room image not found.')

    const bucket = getGridFSBucket()
    const fileId =
      typeof room.imageFileId === 'string'
        ? new mongoose.Types.ObjectId(room.imageFileId)
        : room.imageFileId

    const files = await mongoose.connection.db
      .collection(`${ROOM_IMAGE_BUCKET}.files`)
      .find({ _id: fileId })
      .limit(1)
      .toArray()

    const file = files?.[0]
    if (!file) throw createError(404, 'Room image file not found.')

    res.setHeader('Content-Type', room.imageContentType || file.contentType || 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=86400')

    const downloadStream = bucket.openDownloadStream(fileId)
    downloadStream.on('error', next)
    downloadStream.pipe(res)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listActiveRooms,
  listRoomAdmins,
  listRoomInbox,
  roomDecision,
  listRoomMasters,
  createRoomMaster,
  updateRoomMaster,
  deleteRoomMaster,
  streamRoomImage,

  // optional export for reuse in booking controller later
  weekdayKeyFromYMD,
  isRoomAllowedOnDate,
}