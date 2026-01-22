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

    const eatDate = new Date(b.eatDate)
    if (Number.isNaN(eatDate.getTime())) throw createError(400, 'eatDate is invalid')

    const doc = await FoodRequest.create({
      employee,
      orderType: b.orderType,
      meals: b.meals,
      quantity: Number(b.quantity || 1),
      eatDate,
      eatTimeStart: b.eatTimeStart || '',
      eatTimeEnd: b.eatTimeEnd || '',
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
   GET /api/public/food-requests
   GET /api/chef/food-requests
   GET /api/admin/food-requests
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
   PATCH /api/admin/food-requests/:id/status
   PATCH /api/chef/food-requests/:id/status

   ✅ Emits ONLY ONE socket event:
      - foodRequest:statusChanged (includes oldStatus/newStatus)
   ✅ Sends ONLY ONE telegram message for a real change
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

    // ✅ ONE socket event only (prevents double UI update)
    broadcast(req, 'foodRequest:statusChanged', {
      ...fresh,
      oldStatus,
      newStatus: target,
    })

    // ✅ ONE telegram notify only
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
   ✅ emits: foodRequest:updated (ONLY for real edits)
────────────────────────────────────────────── */
async function updateRequest(req, res, next) {
  try {
    const id = req.params.id
    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    // recommended: only allow edit when NEW
    if (String(doc.status) !== 'NEW') throw createError(400, 'Only NEW requests can be edited')

    const b = req.body || {}

    if (b.eatDate) {
      const eatDate = new Date(b.eatDate)
      if (Number.isNaN(eatDate.getTime())) throw createError(400, 'eatDate is invalid')
      doc.eatDate = eatDate
    }

    if (b.orderType) doc.orderType = b.orderType
    if (Array.isArray(b.meals)) doc.meals = b.meals
    if (b.quantity != null) doc.quantity = Number(b.quantity || 1)

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

    await doc.save()
    const fresh = await FoodRequest.findById(id).lean()

    // ✅ use updated only for edit changes
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
   PATCH /api/public/food-requests/:id/cancel

   ✅ Only allow cancel when status === NEW
   ✅ (Recommended) verify employeeId matches snapshot
   ✅ Broadcast: foodRequest:statusChanged
   ✅ Telegram: FOOD_STATUS_UPDATED
────────────────────────────────────────────── */
async function cancelRequestPublic(req, res, next) {
  try {
    const id = req.params.id

    // recommended: require employeeId to prevent canceling others
    const employeeId = String(req.body?.employeeId || req.query?.employeeId || '').trim()
    if (!employeeId) throw createError(400, 'employeeId is required')

    const doc = await FoodRequest.findById(id)
    if (!doc) throw createError(404, 'Not found')

    const oldStatus = String(doc.status || '').toUpperCase()

    // ensure owner
    const ownerId = String(doc?.employee?.employeeId || '').trim()
    if (ownerId && ownerId !== employeeId) {
      throw createError(403, 'You cannot cancel this request (not owner)')
    }

    // only cancel if NEW
    if (oldStatus !== 'NEW') {
      throw createError(400, 'Only NEW requests can be canceled')
    }

    const target = 'CANCELED'

    // update doc (no reason needed)
    doc.status = target
    doc.cancelReason = '' // keep empty
    doc.statusHistory = Array.isArray(doc.statusHistory) ? doc.statusHistory : []
    doc.statusHistory.push({
      status: target,
      by: `EMPLOYEE:${employeeId}`,
      at: new Date(),
    })

    await doc.save()

    const fresh = await FoodRequest.findById(id).lean()

    // ✅ ONE socket event
    broadcast(req, 'foodRequest:statusChanged', {
      ...fresh,
      oldStatus,
      newStatus: target,
    })

    // ✅ ONE telegram notify
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
