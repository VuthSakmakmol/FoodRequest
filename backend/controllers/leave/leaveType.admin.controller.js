// backend/controllers/leave/leaveType.admin.controller.js
const LeaveType = require('../../models/leave/LeaveType')

/**
 * GET /api/admin/leave/types
 * List all leave types for admin screen
 */
exports.listTypes = async (req, res, next) => {
  try {
    const types = await LeaveType.find({})
      .sort({ code: 1 })
      .lean()

    res.json(types)
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/admin/leave/types
 * Body: { code, name, description, yearlyEntitlement, isActive }
 */
exports.createType = async (req, res, next) => {
  try {
    let {
      code,
      name,
      description = '',
      yearlyEntitlement = 0,
      isActive = true,
    } = req.body || {}

    code = String(code || '').trim().toUpperCase()
    name = String(name || '').trim()

    if (!code || !name) {
      return res.status(400).json({
        message: 'Code and Name are required',
      })
    }

    // prevent duplicate code
    const existing = await LeaveType.findOne({ code })
    if (existing) {
      return res.status(409).json({
        message: `Leave type with code "${code}" already exists`,
      })
    }

    const doc = await LeaveType.create({
      code,
      name,
      description,
      yearlyEntitlement: Number(yearlyEntitlement || 0),
      isActive: Boolean(isActive),
    })

    res.status(201).json(doc)
  } catch (err) {
    // handle Mongo duplicate key just in case unique index exists
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'Leave type code already exists',
      })
    }
    next(err)
  }
}

/**
 * PUT /api/admin/leave/types/:id
 * Body: { code?, name?, description?, yearlyEntitlement?, isActive? }
 */
exports.updateType = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      code,
      name,
      description,
      yearlyEntitlement,
      isActive,
    } = req.body || {}

    const update = {}

    if (code !== undefined) {
      const clean = String(code || '').trim().toUpperCase()
      if (!clean) {
        return res.status(400).json({ message: 'Code cannot be empty' })
      }
      update.code = clean
    }

    if (name !== undefined) {
      const clean = String(name || '').trim()
      if (!clean) {
        return res.status(400).json({ message: 'Name cannot be empty' })
      }
      update.name = clean
    }

    if (description !== undefined) {
      update.description = String(description || '')
    }

    if (yearlyEntitlement !== undefined) {
      update.yearlyEntitlement = Number(yearlyEntitlement || 0)
    }

    if (isActive !== undefined) {
      update.isActive = Boolean(isActive)
    }

    const doc = await LeaveType.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    )

    if (!doc) {
      return res.status(404).json({ message: 'Leave type not found' })
    }

    res.json(doc)
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'Leave type code already exists',
      })
    }
    next(err)
  }
}

/**
 * DELETE /api/admin/leave/types/:id
 */
exports.deleteType = async (req, res, next) => {
  try {
    const { id } = req.params

    const doc = await LeaveType.findByIdAndDelete(id)

    if (!doc) {
      return res.status(404).json({ message: 'Leave type not found' })
    }

    res.json({ message: 'Deleted', id })
  } catch (err) {
    next(err)
  }
}
