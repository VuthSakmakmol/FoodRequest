// backend/routes/leave/leaveProfile.user.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

router.use(auth.requireAuth)

router.get(
  '/me',
  auth.requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_COO',
    'LEAVE_ADMIN',
    'ADMIN',
    'ROOT_ADMIN'
  ),
  ctrl.getMyProfile
)

module.exports = router