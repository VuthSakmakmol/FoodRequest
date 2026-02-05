// backend/routes/leave/leaveUser.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')

// controllers
const userCtrl = require('../../controllers/leave/leaveProfile.user.controller')
const leaveRecordUser = require('../../controllers/leave/leaveRecord.user.controller')

// ✅ Self + manager detail view
// GET /api/leave/user/profile
// GET /api/leave/user/profile?employeeId=E123   (manager view)
router.get('/profile', requireAuth, userCtrl.getMyLeaveProfile)

// ✅ Manager list
// GET /api/leave/user/profile/managed
router.get('/profile/managed', requireAuth, userCtrl.getManagedProfiles)

// ✅ Signature resolve (used by reports / PDF)
router.get('/signatures/resolve/:idLike', requireAuth, leaveRecordUser.resolveSignatureMeta)

// (optional)
// router.get('/record', requireAuth, leaveRecordUser.getMyLeaveRecord)

module.exports = router
