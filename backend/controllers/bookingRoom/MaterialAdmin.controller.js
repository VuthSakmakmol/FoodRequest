// backend/controllers/bookingRoom/MaterialAdmin.controller.js
const createError = require('http-errors')

const BookingRoom = require('../../models/bookingRoom/BookingRoom')
const BookingRoomMaterial = require('../../models/bookingRoom/BookingRoomMaterial')

let User = null
try {
  User = require('../../models/User')
} catch {
  User = null
}

const {
  broadcastBookingRoomRequest,
  broadcastBookingRoomAvailability,
} = require('../../utils/bookingRoom.realtime')

/* ───────────────── notify (Telegram) ───────────────── */
let notify = null
try {
  notify = require('../../services/telegram/bookingRoom')
  console.log('✅ MaterialAdmin telegram notify loaded')
} catch (e) {
  console.warn('⚠️ MaterialAdmin telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') return
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ MaterialAdmin Telegram notify failed:', e?.response?.data || e?.message)
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

function canMaterialAdmin(req) {
  const { roles } = pickIdentityFrom(req)
  return roles.includes('MATERIAL_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
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

async function notifyMaterialDecision(bookingId) {
  try {
    if (!notify) return
    const doc = await BookingRoom.findById(bookingId).lean()
    if (!doc) return
    await safeNotify(notify?.notifyMaterialDecisionToEmployee, doc)
    await safeNotify(notify?.notifyCurrentApprover, doc)
  } catch (e) {
    console.warn('⚠️ notifyMaterialDecision failed:', e?.message)
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

async function findActiveMaterialMastersByCodes(codes = []) {
  const cleanCodes = [...new Set(arr(codes).map(up).filter(Boolean))]
  if (!cleanCodes.length) return []

  return BookingRoomMaterial.find({
    isActive: true,
    code: { $in: cleanCodes },
  }).lean()
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

  if (!isValidTime(timeStart) || !isValidTime(timeEnd)) {
    throw createError(400, 'Invalid booking time.')
  }

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

async function assertMaterialMasterCanDeactivate({ materialDoc, excludePast = true }) {
  if (!materialDoc?._id) return

  const query = {
    materialRequired: true,
    materialStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    'materials.materialCode': up(materialDoc.code),
  }

  if (excludePast) {
    query.bookingDate = { $gte: nowPPDate() }
  }

  const exists = await BookingRoom.findOne(query)
    .select('_id bookingDate timeStart timeEnd materials')
    .lean()

  if (exists) {
    throw createError(
      409,
      `Cannot deactivate material "${s(materialDoc.name) || up(materialDoc.code)}" because it is used by approved booking ${s(exists.bookingDate)} ${s(exists.timeStart)}-${s(exists.timeEnd)}.`
    )
  }
}

async function assertMaterialMasterQtyCanShrink({ materialDoc, nextTotalQty }) {
  const code = up(materialDoc?.code)
  if (!code) return

  const rows = await BookingRoom.find({
    bookingDate: { $gte: nowPPDate() },
    materialRequired: true,
    materialStatus: 'APPROVED',
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    'materials.materialCode': code,
  })
    .select('bookingDate timeStart timeEnd materials')
    .lean()

  if (!rows.length) return

  const byDate = new Map()

  for (const row of rows) {
    const date = s(row.bookingDate)
    if (!date) continue

    let qty = 0
    for (const item of arr(row.materials)) {
      if (up(item?.materialCode) === code) {
        qty += Math.max(0, Number(item?.qty || 0))
      }
    }
    if (qty <= 0) continue

    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(
      { t: toMinutes(row.timeStart), delta: +qty, kind: 'start' },
      { t: toMinutes(row.timeEnd), delta: -qty, kind: 'end' }
    )
  }

  let maxUsed = 0

  for (const events of byDate.values()) {
    events.sort((a, b) => {
      if (a.t !== b.t) return a.t - b.t
      if (a.kind === b.kind) return 0
      return a.kind === 'end' ? -1 : 1
    })

    let running = 0
    for (const ev of events) {
      running += ev.delta
      if (running > maxUsed) maxUsed = running
    }
  }

  if (Number(nextTotalQty) < maxUsed) {
    throw createError(
      409,
      `Cannot reduce material "${s(materialDoc?.name) || code}" stock to ${Number(nextTotalQty)} because approved future bookings require up to ${maxUsed} at the same time.`
    )
  }
}

async function listActiveMaterials(_req, res, next) {
  try {
    const rows = await BookingRoomMaterial.find({ isActive: true })
      .sort({ name: 1 })
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

async function materialDecision(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

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

    if (!doc.materialRequired) {
      throw createError(400, 'This booking does not require material approval.')
    }
    if (up(doc.overallStatus) === 'CANCELLED') {
      throw createError(400, 'Cancelled booking cannot be decided.')
    }
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

    emitBookingRoom(req, doc, 'bookingroom:req:updated')
    emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
    await notifyMaterialDecision(doc._id)

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

async function listMaterialMasters(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const { active = 'ALL', q = '' } = req.query || {}
    const filter = {}

    if (up(active) === 'ACTIVE') filter.isActive = true
    else if (up(active) === 'INACTIVE') filter.isActive = false

    const term = s(q)
    if (term) {
      filter.$or = [{ code: new RegExp(term, 'i') }, { name: new RegExp(term, 'i') }]
    }

    const rows = await BookingRoomMaterial.find(filter)
      .sort({ isActive: -1, name: 1 })
      .lean()

    return res.json(rows || [])
  } catch (err) {
    next(err)
  }
}

async function createMaterialMaster(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const payload = req.body || {}
    const code = up(payload.code).replace(/\s+/g, '_')
    const name = s(payload.name)
    const totalQty = Math.max(0, Number(payload.totalQty || 0))
    const isActive = payload.isActive !== false

    if (!code) throw createError(400, 'code is required.')
    if (!name) throw createError(400, 'name is required.')
    if (!Number.isFinite(totalQty) || totalQty < 0) {
      throw createError(400, 'totalQty must be >= 0.')
    }

    const dup = await BookingRoomMaterial.findOne({
      $or: [{ code }, { name }],
    }).lean()

    if (dup) {
      throw createError(409, 'Material code or material name already exists.')
    }

    const doc = await BookingRoomMaterial.create({
      code,
      name,
      totalQty,
      isActive,
    })

    emitBookingRoomAvailability(
      req,
      {
        type: 'MATERIAL',
        action: 'CREATED',
        materialId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}

async function updateMaterialMaster(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const payload = req.body || {}

    const doc = await BookingRoomMaterial.findById(id)
    if (!doc) throw createError(404, 'Material not found.')

    const nextCode = payload.code != null ? up(payload.code).replace(/\s+/g, '_') : up(doc.code)
    const nextName = payload.name != null ? s(payload.name) : s(doc.name)
    const nextTotalQty =
      payload.totalQty != null
        ? Math.max(0, Number(payload.totalQty || 0))
        : Number(doc.totalQty || 0)
    const nextIsActive = payload.isActive != null ? !!payload.isActive : !!doc.isActive

    if (!nextCode) throw createError(400, 'code is required.')
    if (!nextName) throw createError(400, 'name is required.')
    if (!Number.isFinite(nextTotalQty) || nextTotalQty < 0) {
      throw createError(400, 'totalQty must be >= 0.')
    }

    const dup = await BookingRoomMaterial.findOne({
      _id: { $ne: doc._id },
      $or: [{ code: nextCode }, { name: nextName }],
    }).lean()

    if (dup) {
      throw createError(409, 'Material code or material name already exists.')
    }

    if (doc.isActive && !nextIsActive) {
      await assertMaterialMasterCanDeactivate({
        materialDoc: doc,
        excludePast: true,
      })
    }

    if (nextTotalQty < Number(doc.totalQty || 0)) {
      await assertMaterialMasterQtyCanShrink({
        materialDoc: doc,
        nextTotalQty,
      })
    }

    doc.code = nextCode
    doc.name = nextName
    doc.totalQty = nextTotalQty
    doc.isActive = nextIsActive

    await doc.save()

    emitBookingRoomAvailability(
      req,
      {
        type: 'MATERIAL',
        action: 'UPDATED',
        materialId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.json(doc)
  } catch (err) {
    next(err)
  }
}

async function deleteMaterialMaster(req, res, next) {
  try {
    if (!canMaterialAdmin(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const doc = await BookingRoomMaterial.findById(id)
    if (!doc) throw createError(404, 'Material not found.')

    await assertMaterialMasterCanDeactivate({
      materialDoc: doc,
      excludePast: true,
    })

    doc.isActive = false
    await doc.save()

    emitBookingRoomAvailability(
      req,
      {
        type: 'MATERIAL',
        action: 'DELETED',
        materialId: String(doc._id),
        code: s(doc.code),
      },
      'bookingroom:availability:changed'
    )

    return res.json({ ok: true, _id: doc._id, isActive: doc.isActive })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listActiveMaterials,
  listMaterialAdmins,
  listMaterialInbox,
  materialDecision,
  listMaterialMasters,
  createMaterialMaster,
  updateMaterialMaster,
  deleteMaterialMaster,
}