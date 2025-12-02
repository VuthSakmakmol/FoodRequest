// routes/leave/leave.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRequest.controller')

// All routes here require a logged-in user
router.use(requireAuth)

/**
 * Create a new request
 * Allowed: LEAVE_USER (expat), LEAVE_ADMIN, ADMIN
 */
router.post(
  '/',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.createMyRequest
)

/**
 * Get my requests
 * Allowed: any leave-related role + admin
 * (LEAVE_MANAGER/GM may later use separate endpoints to view subordinates)
 */
router.get(
  '/my',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listMyRequests
)

module.exports = router
