// backend/routes/leave/leaveUser.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')

// controllers
const userCtrl = require('../../controllers/leave/leaveProfile.user.controller')
const leaveRecordUser = require('../../controllers/leave/leaveRecord.user.controller')

// GET /api/leave/user/profile
router.get('/profile', requireAuth, userCtrl.getMyLeaveProfile)

// GET /api/leave/user/signatures/resolve/:idLike
router.get('/signatures/resolve/:idLike', requireAuth, leaveRecordUser.resolveSignatureMeta)

// (optional) if you also have record endpoint here:
// router.get('/record', requireAuth, leaveRecordUser.getMyLeaveRecord)

module.exports = router
