// backend/controllers/bookingRoom/bookingRoom.controller.js
const createError = require('http-errors')
const XLSX = require('xlsx')

const BookingRoom = require('../../models/bookingRoom/BookingRoom')
const BookingRoomResource = require('../../models/bookingRoom/BookingRoomResource')
const BookingRoomMaterial = require('../../models/bookingRoom/BookingRoomMaterial')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const BookingRoomRecurring = require('../../models/bookingRoom/BookingRoomRecurring')
const { isHoliday } = require('../../utils/holidays')

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

const ROOM_BLOCKING_STATUSES = ['PENDING', 'APPROVED', 'PARTIAL_APPROVED']
const MATERIAL_BLOCKING_STATUSES = ['PENDING', 'APPROVED', 'PARTIAL_APPROVED']

function isBlockingRoomStatus(status) {
  return ROOM_BLOCKING_STATUSES.includes(up(status))
}

function isBlockingMaterialStatus(status) {
  return MATERIAL_BLOCKING_STATUSES.includes(up(status))
}


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

function normalizeWeeklyAvailability(wa = {}) {
  return {
    mon: wa?.mon ?? true,
    tue: wa?.tue ?? true,
    wed: wa?.wed ?? true,
    thu: wa?.thu ?? true,
    fri: wa?.fri ?? true,
    sat: wa?.sat ?? true,
    sun: wa?.sun ?? true,
  }
}

function weekdayKeyFromYMD(ymd) {
  if (!isValidDate(ymd)) return ''
  const raw = s(ymd)
  const [year, month, day] = raw.split('-').map(Number)
  const jsDay = new Date(year, month - 1, day).getDay()
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][jsDay] || ''
}

function isRoomAllowedOnDate(roomDoc, bookingDate) {
  const key = weekdayKeyFromYMD(bookingDate)
  if (!key) return true
  const wa = normalizeWeeklyAvailability(roomDoc?.weeklyAvailability)
  return wa[key] !== false
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

    if (!isRoomAllowedOnDate(roomMaster, payload.bookingDate)) {
      throw createError(400, `Selected room is not available on ${payload.bookingDate}.`)
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
    note: s(payload.note),
    needCoffeeBreak: roomRequired ? !!payload.needCoffeeBreak : false,
    needNameOnTable: roomRequired ? !!payload.needNameOnTable : false,
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

async function assertRoomQueueConflict({
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
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd roomCode roomName roomStatus overallStatus')
    .lean()

  const conflictedRow = rows.find((row) => {
    if (!isBlockingRoomStatus(row.roomStatus)) return false

    return overlaps(
      startMin,
      endMin,
      toMinutes(row.timeStart),
      toMinutes(row.timeEnd)
    )
  })

  if (conflictedRow) {
    const roomLabel = s(conflictedRow.roomName) || s(roomCode)
    throw createError(
      409,
      `Room "${roomLabel}" is already reserved for this time slot.`
    )
  }
}

async function assertMaterialQueueConflict({
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
    overallStatus: { $nin: OVERALL_NON_BLOCKING_STATUSES },
    'materials.materialCode': { $in: codes },
  }

  if (excludeId) query._id = { $ne: excludeId }

  const rows = await BookingRoom.find(query)
    .select('timeStart timeEnd materials materialStatus overallStatus')
    .lean()

  const usedMap = {}

  for (const row of rows) {
    if (!isBlockingMaterialStatus(row.materialStatus)) continue

    const timeConflict = overlaps(
      startMin,
      endMin,
      toMinutes(row.timeStart),
      toMinutes(row.timeEnd)
    )
    if (!timeConflict) continue

    for (const item of arr(row.materials)) {
      const code = up(item?.materialCode)
      const qty = Number(item?.qty || 0)
      if (!code || qty <= 0) continue
      usedMap[code] = Number(usedMap[code] || 0) + qty
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

function pad2(n) {
  return String(n).padStart(2, '0')
}

function ymdParts(ymd) {
  const [y, m, d] = s(ymd).split('-').map(Number)
  return { y, m, d }
}

function makeLocalDate(ymd) {
  const { y, m, d } = ymdParts(ymd)
  return new Date(y, m - 1, d)
}

function formatYMD(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addDaysYMD(ymd, days) {
  const dt = makeLocalDate(ymd)
  dt.setDate(dt.getDate() + Number(days || 0))
  return formatYMD(dt)
}

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate()
}

function addMonthsYMD(ymd, months) {
  const { y, m, d } = ymdParts(ymd)
  const totalMonthIndex = (m - 1) + Number(months || 0)
  const year = y + Math.floor(totalMonthIndex / 12)
  const monthIndex = ((totalMonthIndex % 12) + 12) % 12
  const month = monthIndex + 1
  const maxDay = daysInMonth(year, month)
  const day = Math.min(d, maxDay)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function addYearsYMD(ymd, years) {
  const { y, m, d } = ymdParts(ymd)
  const year = y + Number(years || 0)
  const maxDay = daysInMonth(year, m)
  const day = Math.min(d, maxDay)
  return `${year}-${pad2(m)}-${pad2(day)}`
}

function compareYMD(a, b) {
  return s(a).localeCompare(s(b))
}

function weekDayCodeFromYMD(ymd) {
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const dt = makeLocalDate(ymd)
  return map[dt.getDay()] || ''
}

function normalizeRecurringRule(payload = {}) {
  const frequency = up(payload.recurrenceFrequency || payload?.recurrenceRule?.frequency || 'WEEKLY')
  const interval = Math.max(
    1,
    Number(payload.recurrenceInterval || payload?.recurrenceRule?.interval || 1)
  )

  const rawDays =
    payload.recurrenceWeekDays ||
    payload?.recurrenceRule?.byWeekDays ||
    []

  const byWeekDays = [...new Set(
    arr(rawDays)
      .map(up)
      .filter((x) => ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(x))
  )]

  const startDate = s(payload.bookingDate || payload?.recurrenceRule?.startDate)
  const endDate = s(payload.endDate || payload?.recurrenceRule?.endDate)

  const skipHoliday =
    payload.skipHoliday !== false &&
    payload?.recurrenceRule?.skipHoliday !== false

  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) {
    throw createError(400, 'Invalid recurrence frequency.')
  }

  if (!isValidDate(startDate)) {
    throw createError(400, 'Invalid bookingDate (YYYY-MM-DD).')
  }

  if (!isValidDate(endDate)) {
    throw createError(400, 'Invalid endDate (YYYY-MM-DD).')
  }

  if (compareYMD(endDate, startDate) < 0) {
    throw createError(400, 'endDate must be the same or after bookingDate.')
  }

  return {
    frequency,
    interval,
    byWeekDays,
    startDate,
    endDate,
    skipHoliday,
  }
}

function matchesRecurringRule(dateYMD, rule) {
  if (compareYMD(dateYMD, rule.startDate) < 0) return false
  if (compareYMD(dateYMD, rule.endDate) > 0) return false

  if (rule.frequency === 'DAILY') {
    const start = makeLocalDate(rule.startDate)
    const cur = makeLocalDate(dateYMD)
    const diffDays = Math.floor((cur - start) / 86400000)
    return diffDays % rule.interval === 0
  }

  if (rule.frequency === 'WEEKLY') {
    const start = makeLocalDate(rule.startDate)
    const cur = makeLocalDate(dateYMD)
    const diffDays = Math.floor((cur - start) / 86400000)
    const diffWeeks = Math.floor(diffDays / 7)

    const pickedDays = rule.byWeekDays.length
      ? rule.byWeekDays
      : [weekDayCodeFromYMD(rule.startDate)]

    return diffWeeks % rule.interval === 0 && pickedDays.includes(weekDayCodeFromYMD(dateYMD))
  }

  if (rule.frequency === 'MONTHLY') {
    const start = ymdParts(rule.startDate)
    const cur = ymdParts(dateYMD)

    const monthDiff = ((cur.y - start.y) * 12) + (cur.m - start.m)
    if (monthDiff < 0) return false
    if (monthDiff % rule.interval !== 0) return false

    return cur.d === start.d
  }

  if (rule.frequency === 'YEARLY') {
    const start = ymdParts(rule.startDate)
    const cur = ymdParts(dateYMD)

    const yearDiff = cur.y - start.y
    if (yearDiff < 0) return false
    if (yearDiff % rule.interval !== 0) return false

    return cur.m === start.m && cur.d === start.d
  }

  return false
}

function generateRecurringDates(rule, maxDates = 120) {
  const dates = []
  let cursor = rule.startDate

  while (compareYMD(cursor, rule.endDate) <= 0) {
    if (matchesRecurringRule(cursor, rule)) {
      dates.push(cursor)
      if (dates.length > maxDates) {
        throw createError(400, `Maximum ${maxDates} recurring dates allowed.`)
      }
    }

    cursor = addDaysYMD(cursor, 1)
  }

  return dates
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
      { note: new RegExp(term, 'i') },
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
            'overallStatus',
          ].join(' ')
        )
        .lean(),
    ])

    const overlapRows = bookings.filter((row) =>
      overlaps(startMin, endMin, toMinutes(row.timeStart), toMinutes(row.timeEnd))
    )

    const busyRoomCodes = new Set(
      overlapRows
        .filter((x) => x.roomRequired && isBlockingRoomStatus(x.roomStatus) && s(x.roomCode))
        .map((x) => up(x.roomCode))
    )

    const usedMaterialMap = {}

    for (const row of overlapRows) {
      if (!row.materialRequired || !isBlockingMaterialStatus(row.materialStatus)) continue

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
        const blockedByBooking = busyRoomCodes.has(up(r.code))
        const allowedByWeek = isRoomAllowedOnDate(r, date)

        let status = 'AVAILABLE'
        let isAvailable = true
        let shortNote = 'Open every day'

        const wa = normalizeWeeklyAvailability(r.weeklyAvailability)
        const labels = {
          mon: 'Mon',
          tue: 'Tue',
          wed: 'Wed',
          thu: 'Thu',
          fri: 'Fri',
          sat: 'Sat',
          sun: 'Sun',
        }

        const disabled = Object.keys(labels)
          .filter((k) => wa[k] === false)
          .map((k) => labels[k])

        if (disabled.length) {
          shortNote = `Closed: ${disabled.join(', ')}`
        }

        if (!allowedByWeek) {
          isAvailable = false
          status = 'WEEKLY_CLOSED'
          const selectedKey = weekdayKeyFromYMD(date)
          shortNote = `Closed on ${labels[selectedKey] || 'selected day'} every week`
        } else if (blockedByBooking) {
          isAvailable = false
          status = 'UNAVAILABLE'
          shortNote = 'Already reserved for this time slot'
        }

        return {
          _id: r._id,
          code: s(r.code),
          name: s(r.name),
          capacity: Number(r.capacity || 0),
          imageUrl: r.hasImage ? `/api/public/booking-room/rooms/${r._id}/image` : '',
          weeklyAvailability: normalizeWeeklyAvailability(r.weeklyAvailability),
          isAvailable,
          status,
          shortNote,
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
      await assertRoomQueueConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomCode: normalized.roomCode,
      })
    }

    if (normalized.materialRequired) {
      await assertMaterialQueueConflict({
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
      note: normalized.note,
      needCoffeeBreak: normalized.needCoffeeBreak,
      needNameOnTable: normalized.needNameOnTable,

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

async function createRecurringBooking(req, res, next) {
  try {
    const payload = req.body || {}
    const employeeId = parseEmployeeId(req, payload)
    if (!employeeId) throw createError(400, 'employeeId is required.')

    validateBasePayload(payload)

    const rule = normalizeRecurringRule(payload)

    const normalizedBase = await normalizeRequestPayload({
      ...payload,
      bookingDate: rule.startDate,
    })

    const employeeSnapshot = await buildEmployeeSnapshot(employeeId)
    const actor = pickIdentityFrom(req)

    let roomMaster = null
    if (normalizedBase.roomRequired) {
      roomMaster = await BookingRoomResource.findOne({
        isActive: true,
        $or: [
          normalizedBase.roomId ? { _id: normalizedBase.roomId } : null,
          normalizedBase.roomCode ? { code: up(normalizedBase.roomCode) } : null,
          normalizedBase.roomName ? { name: s(normalizedBase.roomName) } : null,
        ].filter(Boolean),
      }).lean()

      if (!roomMaster) {
        throw createError(400, 'Selected room does not exist or is inactive.')
      }
    }

    const rawDates = generateRecurringDates(rule, 120)
    if (!rawDates.length) {
      throw createError(400, 'No recurring dates generated.')
    }

    const roomMatchedDates = []
    const skippedDates = []
    const conflicts = []

    for (const oneDate of rawDates) {
      if (normalizedBase.roomRequired && roomMaster) {
        const allowedByWeek = isRoomAllowedOnDate(roomMaster, oneDate)

        if (!allowedByWeek) {
          skippedDates.push({
            bookingDate: oneDate,
            reason: 'ROOM_WEEKLY_BLOCKED',
          })
          continue
        }
      }

      if (rule.skipHoliday && isHoliday(oneDate)) {
        skippedDates.push({
          bookingDate: oneDate,
          reason: 'HOLIDAY_OR_SUNDAY',
        })
        continue
      }

      roomMatchedDates.push(oneDate)
    }

    if (!roomMatchedDates.length) {
      return res.status(400).json({
        message: 'No valid recurring dates available for this room and date range.',
        skippedDates,
        validBookingDates: [],
        conflicts: [],
      })
    }

    const bookingDates = []

    for (const oneDate of roomMatchedDates) {
      try {
        if (normalizedBase.roomRequired) {
          await assertRoomQueueConflict({
            bookingDate: oneDate,
            timeStart: normalizedBase.timeStart,
            timeEnd: normalizedBase.timeEnd,
            roomCode: normalizedBase.roomCode,
          })
        }

        if (normalizedBase.materialRequired) {
          await assertMaterialQueueConflict({
            bookingDate: oneDate,
            timeStart: normalizedBase.timeStart,
            timeEnd: normalizedBase.timeEnd,
            materials: normalizedBase.materials,
          })
        }

        bookingDates.push(oneDate)
      } catch (err) {
        conflicts.push({
          bookingDate: oneDate,
          type: 'CONFLICT',
          message: err.message || 'Conflict found.',
        })
      }
    }

    if (!bookingDates.length) {
      return res.status(409).json({
        message: 'All recurring dates have conflicts.',
        skippedDates,
        validBookingDates: [],
        conflicts,
      })
    }

    if (conflicts.length) {
      return res.status(409).json({
        message: 'Some selected dates have conflicts.',
        skippedDates,
        validBookingDates: bookingDates,
        conflicts,
      })
    }

    const recurringDoc = await BookingRoomRecurring.create({
      employeeId,
      employee: employeeSnapshot,

      bookingDates,

      recurrenceRule: {
        frequency: rule.frequency,
        interval: rule.interval,
        byWeekDays: rule.byWeekDays,
        startDate: rule.startDate,
        endDate: rule.endDate,
        skipHoliday: rule.skipHoliday,
      },

      timeStart: normalizedBase.timeStart,
      timeEnd: normalizedBase.timeEnd,

      meetingTitle: normalizedBase.meetingTitle,
      purpose: normalizedBase.purpose,
      participantEstimate: normalizedBase.participantEstimate,
      note: normalizedBase.note,

      needCoffeeBreak: normalizedBase.needCoffeeBreak,
      needNameOnTable: normalizedBase.needNameOnTable,
      needWifiPassword: !!payload.needWifiPassword,

      roomRequired: normalizedBase.roomRequired,
      roomId: normalizedBase.roomId,
      roomCode: normalizedBase.roomCode,
      roomName: normalizedBase.roomName,
      room: normalizedBase.room,

      materialRequired: normalizedBase.materialRequired,
      materials: normalizedBase.materials,

      overallStatus: 'PENDING',
      submittedVia: 'PUBLIC_FORM',
      requesterLoginId: actor.loginId,
      createdByLoginId: actor.loginId,
    })

    const createdDocs = []

    for (const oneDate of bookingDates) {
      const doc = await BookingRoom.create({
        employeeId,
        employee: employeeSnapshot,

        requesterLoginId: actor.loginId,
        createdByLoginId: actor.loginId,

        bookingDate: oneDate,
        timeStart: normalizedBase.timeStart,
        timeEnd: normalizedBase.timeEnd,

        meetingTitle: normalizedBase.meetingTitle,
        purpose: normalizedBase.purpose,
        participantEstimate: normalizedBase.participantEstimate,
        note: normalizedBase.note,

        needCoffeeBreak: normalizedBase.needCoffeeBreak,
        needNameOnTable: normalizedBase.needNameOnTable,
        needWifiPassword: !!payload.needWifiPassword,

        roomRequired: normalizedBase.roomRequired,
        roomId: normalizedBase.roomId,
        roomCode: normalizedBase.roomCode,
        roomName: normalizedBase.roomName,
        room: normalizedBase.room,

        materialRequired: normalizedBase.materialRequired,
        materials: normalizedBase.materials,

        roomStatus: normalizedBase.roomRequired ? 'PENDING' : 'NOT_REQUIRED',
        materialStatus: normalizedBase.materialRequired ? 'PENDING' : 'NOT_REQUIRED',
        overallStatus: 'PENDING',

        submittedVia: 'PUBLIC_FORM',
        cancelReason: '',
      })

      createdDocs.push(doc)
    }

    recurringDoc.childBookingIds = createdDocs.map((x) => x._id)
    recurringDoc.totalOccurrences = createdDocs.length
    recurringDoc.updatedAt = new Date()
    await recurringDoc.save()

    for (const doc of createdDocs) {
      emitBookingRoom(req, doc, 'bookingroom:req:created')
      emitBookingRoomAvailability(req, doc, 'bookingroom:availability:changed')
      await notifySafe('BOOKING_ROOM_CREATED', { bookingId: doc._id })
    }

    return res.status(201).json({
      ok: true,
      recurringId: recurringDoc._id,
      totalOccurrences: createdDocs.length,
      skippedDates,
      validBookingDates: bookingDates,
      bookings: createdDocs,
    })
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
      await assertRoomQueueConflict({
        bookingDate: normalized.bookingDate,
        timeStart: normalized.timeStart,
        timeEnd: normalized.timeEnd,
        roomCode: normalized.roomCode,
        excludeId: doc._id,
      })
    }

    if (normalized.materialRequired) {
      await assertMaterialQueueConflict({
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
    doc.note = normalized.note
    doc.needCoffeeBreak = normalized.needCoffeeBreak
    doc.needNameOnTable = normalized.needNameOnTable
    doc.needWifiPassword = normalized.needWifiPassword

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

    doc.roomApproval = {
      byLoginId: '',
      byName: '',
      decision: '',
      note: '',
      decidedAt: null,
    }

    doc.materialApproval = {
      byLoginId: '',
      byName: '',
      decision: '',
      note: '',
      decidedAt: null,
    }

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
      Note: s(b.note),
      NeedCoffeeBreak: b.needCoffeeBreak ? 'YES' : 'NO',
      NeedNameOnTable: b.needNameOnTable ? 'YES' : 'NO',

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
  createRecurringBooking,
  listSchedulePublic,
  listMyBookings,
  updateBooking,
  cancelBooking,
  listAdmin,
  exportAdminExcel,
  getAvailability,
}