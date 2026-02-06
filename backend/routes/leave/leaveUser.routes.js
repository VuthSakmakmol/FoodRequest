// backend/routes/leave/leaveUser.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')

const userCtrl = require('../../controllers/leave/leaveProfile.user.controller')
const leaveRecordUser = require('../../controllers/leave/leaveRecord.user.controller')

// TEMP DEBUG (remove after fixed)
console.log('userCtrl keys:', Object.keys(userCtrl || {}))
console.log('leaveRecordUser keys:', Object.keys(leaveRecordUser || {}))
console.log('requireAuth type:', typeof requireAuth)

// ✅ profile (self + manager/gm detail)
router.get('/profile', requireAuth, userCtrl.getMyLeaveProfile)

// ✅ manager list
router.get('/profile/managed', requireAuth, userCtrl.getManagedProfiles)

// ✅ gm list
router.get('/profile/gm-managed', requireAuth, userCtrl.getGmManagedProfiles)

// ✅ record
// IMPORTANT: your controller must export getMyLeaveRecord
router.get('/record', requireAuth, leaveRecordUser.getMyLeaveRecord)

// ✅ signature resolve
router.get('/signatures/resolve/:idLike', requireAuth, leaveRecordUser.resolveSignatureMeta)

module.exports = router
