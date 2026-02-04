// backend/routes/leave/leaveProfile.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.user.controller')

// ✅ must be authenticated
router.use(requireAuth)

/**
 * GET /api/leave/profile/my
 * - employee self profile (LEAVE_USER)
 * - also allow manager/gm/coo/admin to view own profile
 * - controller supports optional ?employeeId= for approver/admin viewing others
 */
router.get(
  '/my',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.getMyProfile
)

/**
 * GET /api/leave/profile/managed
 * - manager/gm/coo/admin can list employees they manage/approve
 * - leave users cannot access
 */
router.get(
  '/managed',
  requireRole('LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listManagedProfiles
)

module.exports = router
