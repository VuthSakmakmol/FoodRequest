// backend/routes/leave/leaveType-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const leaveTypeAdminCtrl = require('../../controllers/leave/leaveType.admin.controller')

// All routes here are under /api/admin/leave (when mounted in server.js)

// List all leave types (admin view)
router.get(
  '/types',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  leaveTypeAdminCtrl.listLeaveTypes
)

// Create new (non-system) leave type
router.post(
  '/types',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  leaveTypeAdminCtrl.createLeaveType
)

// Update existing leave type
router.put(
  '/types/:id',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  leaveTypeAdminCtrl.updateLeaveType
)

// Delete leave type (non-system only)
router.delete(
  '/types/:id',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  leaveTypeAdminCtrl.deleteLeaveType
)

module.exports = router
