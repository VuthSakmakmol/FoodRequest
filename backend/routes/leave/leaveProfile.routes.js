// backend/routes/leave/leaveProfile.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.user.controller')

router.use(requireAuth)

router.get(
  '/my',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN'),
  ctrl.getMyProfile
)

router.get(
  '/managed',
  requireRole('LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN'),
  ctrl.listManagedProfiles
)

module.exports = router
