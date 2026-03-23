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

function emitBookingRoomMaster(req, payload, event) {
  try {
    const io = getIo(req)
    if (!io || !event) return
    broadcastBookingRoomMaster(io, payload, event)
  } catch (e) {
    console.warn('⚠️ booking room master realtime emit failed:', e?.message)
  }
}

function emitBookingRoomMastersChanged(req, payload = {}, event = 'bookingroom:masters:changed') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastBookingRoomMastersChanged(io, payload, event)
  } catch (e) {
    console.warn('⚠️ booking room masters changed emit failed:', e?.message)
  }
}

async function notifyRoomDecision(bookingId) {
  try {
    if (!notify) return
    const doc = await BookingRoom.findById(bookingId).lean()
    if (!doc) return
    await safeNotify(notify?.notifyRoomDecisionToEmployee, doc)
    await safeNotify(notify?.notifyCurrentApprover, doc)
  } catch (e) {
    console.warn('⚠️ notifyRoomDecision failed:', e?.message)
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

async function assertRoomApprovalConflict({
  bookingDate,
  timeStart,
  timeEnd,
  roomCode,
  excludeId = null,
}) {
  if (!s(roomCode)) return

  if (!isValidTime(timeStart) || !isValidTime(timeEnd)) {
    throw createError(400, 'Invalid booking time.')
  }

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

async function assertRoomMasterCanDeactivate({ roomDoc, excludePast = true }) {
  if (!roomDoc?._id) return

  const query = {
    roomRequired: true,
    roomStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    $or: [{ roomId: roomDoc._id }, { roomCode: up(roomDoc.code) }, { roomName: s(roomDoc.name) }],
  }

  if (excludePast) {
    query.bookingDate = { $gte: nowPPDate() }
  }

  const exists = await BookingRoom.findOne(query)
    .select('_id bookingDate timeStart timeEnd roomName roomCode')
    .lean()

  if (exists) {
    throw createError(
      409,
      `Cannot deactivate room "${s(roomDoc.name) || up(roomDoc.code)}" because it is used by approved booking ${s(exists.bookingDate)} ${s(exists.timeStart)}-${s(exists.timeEnd)}.`
    )
  }
}

function getGridFSBucket() {
  const db = mongoose.connection.db
  if (!db) {
    throw createError(500, 'MongoDB connection is not ready.')
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: ROOM_IMAGE_BUCKET })
}

function safeRoomImageFilename(originalname) {
  const raw = s(originalname || 'room-image')
  const dotIndex = raw.lastIndexOf('.')
  const ext = dotIndex >= 0 ? raw.slice(dotIndex).toLowerCase() : ''
  const base = (dotIndex >= 0 ? raw.slice(0, dotIndex) : raw)
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'room-image'

  return `${Date.now()}-${base}${ext}`
}

async function uploadRoomImageToGridFS(file, meta = {}) {
  if (!file?.buffer) return null

  const bucket = getGridFSBucket()
  const filename = safeRoomImageFilename(file.originalname)

  return await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.mimetype || 'application/octet-stream',
      metadata: {
        module: 'booking_room',
        ...meta,
      },
    })

    uploadStream.on('error', reject)
    uploadStream.on('finish', () => {
      resolve({
        fileId: uploadStream.id,
        filename,
        contentType: file.mimetype || 'application/octet-stream',
      })
    })

    Readable.from(file.buffer).pipe(uploadStream)
  })
}

async function deleteRoomImageFromGridFS(fileId) {
  try {
    if (!fileId) return
    const bucket = getGridFSBucket()
    const objectId =
      typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId
    await bucket.delete(objectId)
  } catch (e) {
    console.warn('⚠️ failed to delete old room image from GridFS:', e?.message)
  }
}

function buildRoomImageApiUrl(roomId) {
  if (!roomId) return ''
  return `/api/public/booking-room/rooms/${roomId}/image`
}

async function listActiveRooms(_req, res, next) {
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
    await notifyRoomDecision(doc._id)

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
}