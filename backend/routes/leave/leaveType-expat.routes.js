// backend/routes/leave/leaveType-expat.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const LeaveType = require('../../models/leave/LeaveType')

// All here need login
router.use(requireAuth)

/**
 * GET /api/leave/types
 * Public for leave roles (including LEAVE_USER)
 * Returns active leave types
 */
router.get(
  '/types',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'ADMIN'
  ),
  async (req, res, next) => {
    try {
      const types = await LeaveType.find({ isActive: true })
        .sort({ code: 1 })
        .lean()

      res.json(types)
    } catch (err) {
      next(err)
    }
  }
)

module.exports = router
