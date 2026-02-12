// backend/routes/leave/leaveProfile.user.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.user.controller')

// user auth
router.use(auth.requireAuth)

// ✅ allow LEAVE_USER and above
router.get(
  '/me',
  auth.requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.getMyLeaveProfile
)

module.exports = router
