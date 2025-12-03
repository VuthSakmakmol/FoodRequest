// backend/routes/leave/leave.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRequest.controller')

// All routes here require a logged-in user
router.use(requireAuth)

/**
 * POST /api/leave/requests
 * Create a new leave request
 * Allowed: LEAVE_USER (expat), LEAVE_ADMIN, ADMIN
 */
router.post(
  '/',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.createMyRequest
)

/**
 * GET /api/leave/requests/my
 * Get my own leave requests
 * Allowed: any leave-related role + admin
 */
router.get(
  '/my',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'ADMIN'
  ),
  ctrl.listMyRequests
)

module.exports = router
