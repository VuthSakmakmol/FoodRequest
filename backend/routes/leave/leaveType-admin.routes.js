// backend/routes/leave/leaveType-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveType.admin.controller')

/**
 * READ: list leave types
 * Allowed: all leave-related roles + ADMIN
 */
router.get(
  '/types',
  requireAuth,
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'ADMIN'
  ),
  ctrl.listTypes
)

/**
 * CREATE: leave type
 * Allowed: LEAVE_ADMIN + ADMIN only
 */
router.post(
  '/types',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  ctrl.createType
)

/**
 * UPDATE: leave type
 * Allowed: LEAVE_ADMIN + ADMIN only
 */
router.put(
  '/types/:id',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  ctrl.updateType
)

/**
 * DELETE: leave type
 * Allowed: LEAVE_ADMIN + ADMIN only
 */
router.delete(
  '/types/:id',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  ctrl.deleteType
)

module.exports = router
