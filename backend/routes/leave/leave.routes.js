// backend/routes/leave/leave.routes.js
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
 */
router.get(
  '/my',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listMyRequests
)

/**
 * Manager inbox: requests waiting for THIS manager
 */
router.get(
  '/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listManagerInbox
)

/**
 * Manager decision (approve / reject)
 */
router.post(
  '/:id/manager-decision',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.managerDecision
)

/**
 * GM inbox: requests waiting for THIS GM
 */
router.get(
  '/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listGmInbox
)

/**
 * GM decision (approve / reject)
 */
router.post(
  '/:id/gm-decision',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.gmDecision
)

module.exports = router
