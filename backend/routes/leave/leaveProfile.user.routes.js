// backend/routes/leave/leaveProfile.user.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')
const userCtrl = require('../../controllers/leave/leaveProfile.user.controller')

router.get('/profile', requireAuth, userCtrl.getMyLeaveProfile)

router.get('/team/profiles', requireAuth, userCtrl.getTeamLeaveProfiles)
router.get('/team/profiles/:employeeId', requireAuth, userCtrl.getTeamEmployeeProfile)

module.exports = router
