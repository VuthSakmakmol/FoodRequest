// backend/controllers/leave/leaveType.admin.controller.js
const LeaveType = require('../../models/leave/LeaveType')

/**
 * System leave types – hard business rules
 *
 * AL = 18 days/year (1.5 per month)
 * MC = 60 days/year
 * MA = 90 days fixed
 * SP = 7 days/year
 * UL = unlimited (no balance, no yearly limit)
 */
const SYSTEM_TYPES = [
  {
    code: 'AL',
    name: 'Annual Leave',
    description: 'Annual Leave (AL)',
    requiresBalance: true,
    yearlyEntitlement: 18,
    accrualPerMonth: 1.5,
    yearlyLimit: 18,
    fixedDurationDays: 0,
    allowNegative: true,   // can borrow via SP
    isSystem: true,
    isActive: true,
    order: 1,
  },
  {
    code: 'MC',
    name: 'Sick Leave (MC)',
    description: 'Sick Leave (MC)',
    requiresBalance: true,
    yearlyEntitlement: 60,
    accrualPerMonth: 0,
    yearlyLimit: 60,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    order: 2,
  },
  {
    code: 'MA',
    name: 'Maternity Leave (MA)',
    description: 'Maternity Leave (fixed 90 days)',
    requiresBalance: true,
    yearlyEntitlement: 90,
    accrualPerMonth: 0,
    yearlyLimit: 90,
    fixedDurationDays: 90, // enforce 90 days
    allowNegative: false,
    isSystem: true,
    isActive: true,
    order: 3,
  },
  {
    code: 'SP',
    name: 'Special Leave (SP)',
    description: 'Special Leave (borrow from future AL, max 7 days/year)',
    requiresBalance: true,
    yearlyEntitlement: 7,
    accrualPerMonth: 0,
    yearlyLimit: 7,
    fixedDurationDays: 0,
    allowNegative: true, // borrowing
    isSystem: true,
    isActive: true,
    order: 4,
  },
  {
    code: 'UL',
    name: 'Unpaid Leave (UL)',
    description: 'Unpaid Leave (no yearly limit)',
    requiresBalance: false,
    yearlyEntitlement: 0,
    accrualPerMonth: 0,
    yearlyLimit: 0,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    order: 5,
  },
]

/**
 * Seed / sync the 5 system leave types.
 * Call this once after Mongo is connected (in server.js).
 */
async function ensureSystemTypes() {
  const bulkOps = SYSTEM_TYPES.map(t => ({
    updateOne: {
      filter: { code: t.code },
      update: {
        $set: {
          name: t.name,
          description: t.description,
          requiresBalance: t.requiresBalance,
          yearlyEntitlement: t.yearlyEntitlement,
          accrualPerMonth: t.accrualPerMonth,
          yearlyLimit: t.yearlyLimit,
          fixedDurationDays: t.fixedDurationDays,
          allowNegative: t.allowNegative,
          isSystem: true,
          isActive: true, // 👈 always active by default
          order: t.order,
        },
      },
      upsert: true,
    },
  }))

  if (bulkOps.length) {
    await LeaveType.bulkWrite(bulkOps)
  }
}

/**
 * GET /api/admin/leave/types
 * List all leave types (admin view)
 */
async function listLeaveTypes(req, res, next) {
  try {
    const docs = await LeaveType.find({})
      .sort({ order: 1, code: 1 })
      .lean()

    res.json(docs)
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/admin/leave/types
 * Create a new (non-system) leave type
 */
async function createLeaveType(req, res, next) {
  try {
    let {
      code,
      name,
      description = '',
      requiresBalance = true,
      yearlyEntitlement = 0,
      accrualPerMonth = 0,
      yearlyLimit = 0,
      fixedDurationDays = 0,
      allowNegative = false,
      isActive = true,
      order = 0,
    } = req.body || {}

    code = String(code || '').trim().toUpperCase()
    name = String(name || '').trim()

    if (!code || !name) {
      return res.status(400).json({ message: 'Code and Name are required.' })
    }

    // Prevent accidental re-creation of system codes here
    const reservedCodes = SYSTEM_TYPES.map(t => t.code)
    if (reservedCodes.includes(code)) {
      return res.status(400).json({
        message: `Code "${code}" is reserved as a system type. Use ensureSystemTypes / seed, not UI.`,
      })
    }

    const doc = await LeaveType.create({
      code,
      name,
      description,
      requiresBalance,
      yearlyEntitlement,
      accrualPerMonth,
      yearlyLimit,
      fixedDurationDays,
      allowNegative,
      isActive,
      isSystem: false, // created via UI are always non-system
      order,
    })

    res.status(201).json(doc)
  } catch (err) {
    // Handle duplicate key error nicely
    if (err.code === 11000 && err.keyPattern && err.keyPattern.code) {
      return res.status(400).json({ message: 'Code already exists.' })
    }
    next(err)
  }
}

/**
 * PUT /api/admin/leave/types/:id
 * Update an existing leave type
 *
 * - For system types (isSystem: true), only allow:
 *   name, description, isActive, order
 * - For non-system, allow full field update.
 */
async function updateLeaveType(req, res, next) {
  try {
    const { id } = req.params
    const doc = await LeaveType.findById(id)
    if (!doc) {
      return res.status(404).json({ message: 'Leave type not found.' })
    }

    const body = req.body || {}
    const isSystem = doc.isSystem

    // Fields allowed for system vs non-system
    const baseEditable = ['name', 'description', 'isActive', 'order']
    const fullEditable = [
      'name',
      'description',
      'requiresBalance',
      'yearlyEntitlement',
      'accrualPerMonth',
      'yearlyLimit',
      'fixedDurationDays',
      'allowNegative',
      'isActive',
      'order',
    ]

    const editableFields = isSystem ? baseEditable : fullEditable

    for (const key of editableFields) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        doc[key] = body[key]
      }
    }

    // Never allow code or isSystem to be changed via API
    if (Object.prototype.hasOwnProperty.call(body, 'code')) {
      // ignore
    }
    if (Object.prototype.hasOwnProperty.call(body, 'isSystem')) {
      // ignore
    }

    await doc.save()
    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/**
 * DELETE /api/admin/leave/types/:id
 * Delete a leave type
 *
 * - System types (AL/MC/MA/SP/UL) cannot be deleted.
 */
async function deleteLeaveType(req, res, next) {
  try {
    const { id } = req.params
    const doc = await LeaveType.findById(id)

    if (!doc) {
      return res.status(404).json({ message: 'Leave type not found.' })
    }

    if (doc.isSystem) {
      return res.status(400).json({
        message: `Cannot delete system leave type "${doc.code}".`,
      })
    }

    await doc.deleteOne()
    res.json({ message: 'Leave type deleted.' })
  } catch (err) {
    next(err)
  }
}

/* Exports */
module.exports = {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,

  // aliases
  list: listLeaveTypes,
  create: createLeaveType,
  update: updateLeaveType,
  remove: deleteLeaveType,

  // system seeding
  ensureSystemTypes,
}
