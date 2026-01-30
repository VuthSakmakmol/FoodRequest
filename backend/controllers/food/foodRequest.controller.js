// backend/controllers/food/foodRequest.controller.js
const createError = require('http-errors')
const FoodRequest = require('../../models/food/FoodRequest')
const RecurringTemplate = require('../../models/food/RecurringTemplate')

// ✅ Telegram notify (single message per important change)
const { notifyFood } = require('../../services/food.telegram.notify')

let EmployeeDir = null
try { EmployeeDir = require('../../models/EmployeeDirectory') } catch { EmployeeDir = null }
try { if (!EmployeeDir) EmployeeDir = require('../../models/Employee') } catch { /* ignore */ }

// ✅ Keep only your real statuses
const STATUS = ['NEW', 'ACCEPTED', 'CANCELED']

// ✅ LIMIT order types (enforced server-side)
const ORDER_TYPES_ALLOWED = ['Daily meal', 'Meeting catering', 'Visitor meal']

// ✅ Cambodia timezone (strict time rules must use THIS)
const TZ = 'Asia/Phnom_Penh'

// ✅ Meal cutoff rules (apply to ALL order types)
const MEAL_CUTOFF = {
  Breakfast: '08:00',
  Lunch: '10:00',
  Dinner: '15:00',
  // Snack: no cutoff (if you want, add one here)
}

function escapeRegExp(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ymdFromDate(d) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  const yyyy = String(dt.getFullYear())
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Format a Date to YYYY-MM-DD in a specific timezone */
function ymdInTZ(date, timeZone = TZ) {
  const dt = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(dt.getTime())) return ''
  // en-CA gives YYYY-MM-DD format
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)
}

/** Current HH:mm in a specific timezone */
function hhmmNowInTZ(timeZone = TZ) {
  const now = new Date()
  // Use formatToParts to avoid locale weirdness
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const h = parts.find(p => p.type === 'hour')?.value || '00'
  const m = parts.find(p => p.type === 'minute')?.value || '00'
  return `${h}:${m}`
}

function isValidHHmm(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim())
}

/**
 * STRICT RULES:
 * - No past eatDate (Cambodia day)
 * - If eatDate is TODAY (Cambodia day), reject meals whose cutoff has passed
 * - Applies to ALL order types (Daily/Meeting/Visitor)
 */
function enforceStrictMealCutoff({ eatDate, meals }) {
  const eat = new Date(eatDate)
  if (Number.isNaN(eat.getTime())) throw createError(400, 'eatDate is invalid')

  const eatYMD = ymdInTZ(eat, TZ)
  const todayYMD = ymdInTZ(new Date(), TZ)
  if (!eatYMD) throw createError(400, 'eatDate is invalid')

  // no past day
  if (eatYMD < todayYMD) {
    throw createError(400, `eatDate cannot be in the past (${eatYMD}).`)
  }

  // only enforce cutoffs when eatDate is today
  if (eatYMD !== todayYMD) return

  const nowHHmm = hhmmNowInTZ(TZ)

  const list = Array.isArray(meals) ? meals : []
  const blocked = []

  for (const m of list) {
    const meal = String(m || '').trim()
    const cutoff = MEAL_CUTOFF[meal]
    if (!cutoff) continue // meal has no cutoff rule
    // lexicographic HH:mm compare works for 24h strings
    if (nowHHmm > cutoff) blocked.push(`${meal} (cutoff ${cutoff})`)
  }

  if (blocked.length) {
    throw createError(
      400,
      `Too late to order: ${blocked.join(', ')}. Current time ${nowHHmm} (${TZ}).`
    )
  }
}

/** Validate orderType strictly (limit it) */
function enforceOrderType(orderType) {
  const v = String(orderType || '').trim()
  if (!v) throw createError(400, 'orderType is required')
  if (!ORDER_TYPES_ALLOWED.includes(v)) {
    throw createError(400, `Invalid orderType. Allowed: ${ORDER_TYPES_ALLOWED.join(', ')}`)
  }
  return v
}

/** Validate eat time range if provided */
function validateEatTimeRange(eatTimeStart, eatTimeEnd) {
  const s = String(eatTimeStart || '').trim()
  const e = String(eatTimeEnd || '').trim()
  if (!s && !e) return { s: '', e: '' }

  if (!s || !e) throw createError(400, 'eatTimeStart and eatTimeEnd must both be provided')
  if (!isValidHHmm(s) || !isValidHHmm(e)) throw createError(400, 'eatTimeStart/eatTimeEnd must be HH:mm')
  if (e <= s) throw createError(400, 'eatTimeEnd must be after eatTimeStart')
  return { s, e }
}

// ✅ transition rules (3-status)
function canTransition(from, to) {
  if (!STATUS.includes(to)) return false
  if (from === to) return true
  if (from === 'NEW') return to === 'ACCEPTED' || to === 'CANCELED'
  if (from === 'ACCEPTED') return to === 'CANCELED'
  return false
}

function broadcast(req, event, payload) {
  try {
    const io = req.io || req.app?.get?.('io')
    if (io) io.emit(event, payload)
  } catch (_) {}
}

/* ──────────────────────────────────────────────
   PUBLIC: createRequest  ✅ NO LOGIN REQUIRED
   POST /api/public/food-requests
────────────────────────────────────────────── */
async function createRequest(req, res, next) {
  try {
    const b = req.body || {}

    const employeeId = String(b.employeeId || '').trim()
    if (!employeeId) throw createError(400, 'employeeId is required')

    // Fill employee snapshot from directory (recommended)
    let emp = null
    if (EmployeeDir) {
      emp = await EmployeeDir.findOne({ employeeId }).lean()
    }

    const employee = {
      employeeId,
      name: String(emp?.name || b.name || '').trim(),
      department: String(emp?.department || b.department || '').trim(),
    }
    if (!employee.name) throw createError(400, 'Employee name not found (directory) and not provided')
    if (!employee.department) throw createError(400, 'Employee department not found (directory) and not provided')

    // ✅ LIMIT order type
    const orderType = enforceOrderType(b.orderType)

    // eatDate
    const eatDate = new Date(b.eatDate)
    if (Number.isNaN(eatDate.getTime())) throw createError(400, 'eatDate is invalid')

    const meals = Array.isArray(b.meals) ? b.meals : []
    if (!meals.length) throw createError(400, 'Please select at least one meal.')

    // ✅ STRICT cutoff for ALL order types
    enforceStrictMealCutoff({ eatDate, meals })

    // ✅ Validate time range if provided (works for ALL order types)
    const { s: eatTimeStart, e: eatTimeEnd } = validateEatTimeRange(b.eatTimeStart, b.eatTimeEnd)

    const doc = await FoodRequest.create({
      employee,
      orderType,
      meals,
      quantity: Number(b.quantity || 1),
      eatDate,
      eatTimeStart: eatTimeStart || '',
      eatTimeEnd: eatTimeEnd || '',
      location: {
        kind: b?.location?.kind,
        other: b?.location?.other || '',
      },

      menuChoices: Array.isArray(b.menuChoices) ? b.menuChoices : [],
      menuCounts: Array.isArray(b.menuCounts) ? b.menuCounts : [],

      dietary: Array.isArray(b.dietary) ? b.dietary : [],
      dietaryCounts: Array.isArray(b.dietaryCounts) ? b.dietaryCounts : [],
      dietaryOther: b.dietaryOther || '',

      specialInstructions: b.specialInstructions || '',

      status: 'NEW',
      statusHistory: [{ status: 'NEW', by: 'PUBLIC', at: new Date() }],
      cancelReason: '',
      recurring: {
        enabled: !!b?.recurring?.enabled,
        frequency: b?.recurring?.frequency || 'Daily',
        endDate: b?.recurring?.endDate ? new Date(b.recurring.endDate) : undefined,
        skipHolidays: b?.recurring?.skipHolidays !== undefined ? !!b.recurring.skipHolidays : true,
        source: b?.recurring?.enabled ? 'RECURRING' : 'MANUAL',
      },
    })

    // If recurring enabled: create template + link first occurrence
    if (doc?.recurring?.enabled) {
      const tpl = await RecurringTemplate.create({
        owner: employee,
        orderType: doc.orderType,
        meals: doc.meals,
        quantity: doc.quantity,
        location: doc.location,
        menuChoices: doc.menuChoices,
        menuCounts: doc.menuCounts,
        dietary: doc.dietary,
        dietaryOther: doc.dietaryOther,
        dietaryCounts: doc.dietaryCounts,

        frequency: doc.recurring.frequency || 'Daily',
        startDate: doc.eatDate,
        endDate: doc.recurring.endDate,
        skipHolidays: !!doc.recurring.skipHolidays,

        eatTimeStart: doc.eatTimeStart || null,
        eatTimeEnd: doc.eatTimeEnd || null,

        status: 'ACTIVE',
        nextRunAt: null,
        skipDates: [],
      })

      doc.recurring.source = 'RECURRING'
      doc.recurring.templateId = tpl._id
      doc.recurring.occurrenceDate = ymdFromDate(doc.eatDate)
      await doc.save()
    }

    const fresh = await FoodRequest.findById(doc._id).lean()

    // ✅ ONE socket event for create
    broadcast(req, 'foodRequest:created', fresh)

    // ✅ ONE telegram notify for create
    try {
      await notifyFood('FOOD_REQUEST_CREATED', { requestId: doc._id })
    } catch (e) {
      console.warn('[foodRequest] notifyFood create failed:', e?.message)
    }

    return res.status(201).json(fresh)
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   PUBLIC/CHEF/ADMIN: listRequests
────────────────────────────────────────────── */
async function listRequests(req, res, next) {
  try {
    const { status, employeeId, q, from, to, page = 1, limit = 50 } = req.query || {}
    const filter = {}

    if (status && status !== 'ALL') filter.status = String(status).toUpperCase()
    if (employeeId) filter['employee.employeeId'] = String(employeeId)

    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegExp(String(q).trim()), 'i')
      filter.$or = [
        { orderType: rx },
        { 'location.kind': rx },
        { specialInstructions: rx },
        { menuChoices: rx },
        { requestId: rx },
        { 'employee.employeeId': rx },
        { 'employee.name': rx },
      ]
    }

    if (from || to) {
      const range = {}
      if (from) {
        const d = new Date(from)
        if (!Number.isNaN(d.getTime())) range.$gte = d
      }
      if (to) {
        const dt = new Date(to)
        if (!Number.isNaN(dt.getTime())) {
          dt.setHours(23, 59, 59, 999)
          range.$lte = dt
        }
      }
      if (Object.keys(range).length) filter.eatDate = range
    }

    const p = Math.max(parseInt(page, 10) || 1, 1)
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
    const skip = (p - 1) * lim

    const [rows, total] = await Promise.all([
      FoodRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      FoodRequest.countDocuments(filter),
    ])

    res.json({ rows, page: p, limit: lim, total })
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   ADMIN/CHEF: updateStatus
────────────────────────────────────────────── */
async function updateStatus(req, res, next) {
  try {
    const id = req.params.id
    const target = String(req.body?.status || '').trim().toUpperCase()
    const reason = String(req.body?.reason || '').trim()

    if (!STATUS.includes(target)) throw createError(400, `Invalid status: ${target}`)

    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    const oldStatus = String(doc.status || '').toUpperCase()

    if (!canTransition(oldStatus, target)) {
      throw createError(400, `Invalid transition: ${oldStatus} → ${target}`)
    }

    // ✅ No change => no broadcast, no telegram
    if (oldStatus === target) {
      const same = await FoodRequest.findById(id).lean()
      return res.json(same)
    }

    if (target === 'CANCELED') {
      doc.cancelReason = reason || doc.cancelReason || ''
    }

    doc.status = target
    doc.statusHistory = Array.isArray(doc.statusHistory) ? doc.statusHistory : []
    doc.statusHistory.push({
      status: target,
      by: String(req.user?.role || req.user?.loginId || 'SYSTEM'),
      at: new Date(),
    })

    await doc.save()
    const fresh = await FoodRequest.findById(id).lean()

    broadcast(req, 'foodRequest:statusChanged', {
      ...fresh,
      oldStatus,
      newStatus: target,
    })

    try {
      await notifyFood('FOOD_STATUS_UPDATED', {
        requestId: id,
        oldStatus,
        newStatus: target,
      })
    } catch (e) {
      console.warn('[foodRequest] notifyFood status failed:', e?.message)
    }

    return res.json(fresh)
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   ADMIN/CHEF: updateRequest (optional edits)
   ✅ still strict: orderType limit + cutoff rules
────────────────────────────────────────────── */
async function updateRequest(req, res, next) {
  try {
    const id = req.params.id
    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    // recommended: only allow edit when NEW
    if (String(doc.status) !== 'NEW') throw createError(400, 'Only NEW requests can be edited')

    const b = req.body || {}

    // orderType (limited)
    if (b.orderType != null) {
      doc.orderType = enforceOrderType(b.orderType)
    }

    // eatDate
    if (b.eatDate) {
      const eatDate = new Date(b.eatDate)
      if (Number.isNaN(eatDate.getTime())) throw createError(400, 'eatDate is invalid')
      doc.eatDate = eatDate
    }

    // meals
    if (Array.isArray(b.meals)) {
      if (!b.meals.length) throw createError(400, 'Please select at least one meal.')
      doc.meals = b.meals
    }

    if (b.quantity != null) doc.quantity = Number(b.quantity || 1)

    // time range if provided
    if (b.eatTimeStart != null || b.eatTimeEnd != null) {
      const { s, e } = validateEatTimeRange(b.eatTimeStart, b.eatTimeEnd)
      doc.eatTimeStart = s || ''
      doc.eatTimeEnd = e || ''
    }

    if (b.location) {
      doc.location = {
        kind: b.location.kind,
        other: b.location.other || '',
      }
    }

    if (Array.isArray(b.menuChoices)) doc.menuChoices = b.menuChoices
    if (Array.isArray(b.menuCounts)) doc.menuCounts = b.menuCounts

    if (Array.isArray(b.dietary)) doc.dietary = b.dietary
    if (Array.isArray(b.dietaryCounts)) doc.dietaryCounts = b.dietaryCounts
    if (b.dietaryOther != null) doc.dietaryOther = String(b.dietaryOther || '')

    if (b.specialInstructions != null) doc.specialInstructions = String(b.specialInstructions || '')

    // ✅ STRICT cutoff check after edits (ALL order types)
    enforceStrictMealCutoff({ eatDate: doc.eatDate, meals: doc.meals })

    await doc.save()
    const fresh = await FoodRequest.findById(id).lean()

    broadcast(req, 'foodRequest:updated', fresh)
    res.json(fresh)
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   ADMIN/CHEF: deleteRequest
────────────────────────────────────────────── */
async function deleteRequest(req, res, next) {
  try {
    const id = req.params.id
    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    // safe rule
    if (String(doc.status) !== 'NEW') throw createError(400, 'Only NEW requests can be deleted')

    await FoodRequest.deleteOne({ _id: id })
    broadcast(req, 'foodRequest:deleted', { _id: id })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   ADMIN/CHEF: dashboard (simple)
────────────────────────────────────────────── */
async function dashboard(req, res, next) {
  try {
    const { from, to } = req.query || {}
    const match = {}

    if (from || to) {
      const range = {}
      if (from) {
        const d = new Date(from)
        if (!Number.isNaN(d.getTime())) range.$gte = d
      }
      if (to) {
        const dt = new Date(to)
        if (!Number.isNaN(dt.getTime())) {
          dt.setHours(23, 59, 59, 999)
          range.$lte = dt
        }
      }
      if (Object.keys(range).length) match.eatDate = range
    }

    const byStatus = await FoodRequest.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
      { $sort: { status: 1 } },
    ])

    res.json({
      totals: { all: byStatus.reduce((s, x) => s + x.count, 0) },
      byStatus,
    })
  } catch (err) {
    next(err)
  }
}

/* ──────────────────────────────────────────────
   PUBLIC: cancelRequest (employee)
────────────────────────────────────────────── */
async function cancelRequestPublic(req, res, next) {
  try {
    const id = req.params.id

    const employeeId = String(req.body?.employeeId || req.query?.employeeId || '').trim()
    if (!employeeId) throw createError(400, 'employeeId is required')

    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    const oldStatus = String(doc.status || '').toUpperCase()

    const ownerId = String(doc?.employee?.employeeId || '').trim()
    if (ownerId && ownerId !== employeeId) {
      throw createError(403, 'You cannot cancel this request (not owner)')
    }

    if (oldStatus !== 'NEW') {
      throw createError(400, 'Only NEW requests can be canceled')
    }

    const target = 'CANCELED'

    doc.status = target
    doc.cancelReason = ''
    doc.statusHistory = Array.isArray(doc.statusHistory) ? doc.statusHistory : []
    doc.statusHistory.push({
      status: target,
      by: `EMPLOYEE:${employeeId}`,
      at: new Date(),
    })

    await doc.save()

    const fresh = await FoodRequest.findById(id).lean()

    broadcast(req, 'foodRequest:statusChanged', {
      ...fresh,
      oldStatus,
      newStatus: target,
    })

    try {
      await notifyFood('FOOD_STATUS_UPDATED', {
        requestId: id,
        oldStatus,
        newStatus: target,
      })
    } catch (e) {
      console.warn('[foodRequest] notifyFood cancel failed:', e?.message)
    }

    return res.json(fresh)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createRequest,
  listRequests,
  updateStatus,
  updateRequest,
  deleteRequest,
  dashboard,
  cancelRequestPublic,
}
