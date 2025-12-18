// backend/routes/leave/leaveType-expat.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const { SYSTEM_TYPES } = require('../../config/leaveSystemTypes')

router.use(requireAuth)

router.get(
  '/types',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  async (_req, res) => {
    res.json(SYSTEM_TYPES)
  }
)

module.exports = router
