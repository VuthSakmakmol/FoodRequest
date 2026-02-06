// backend/routes/leave/leaveUser.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')

// controllers
const userCtrl = require('../../controllers/leave/leaveProfile.user.controller')
const leaveRecordUser = require('../../controllers/leave/leaveRecord.user.controller')

// ───────────────── Profile ─────────────────

// ✅ Self OR role-authorized staff view
// GET /api/leave/user/profile?employeeId=xxxx&contractId=...
router.get('/profile', requireAuth, userCtrl.getMyLeaveProfile)

// ✅ Manager staff list (under this manager)
router.get('/profile/managed', requireAuth, userCtrl.getManagedProfiles)

// ✅ GM staff list (GM_ONLY mode only)
router.get('/profile/gm-managed', requireAuth, userCtrl.getGmManagedProfiles)

// ✅ COO staff list (GM_AND_COO mode only)
router.get('/profile/coo-managed', requireAuth, userCtrl.getCooManagedProfiles)

// ───────────────── Signatures ─────────────────

// ✅ GET /api/leave/user/signatures/resolve/:idLike
router.get('/signatures/resolve/:idLike', requireAuth, leaveRecordUser.resolveSignatureMeta)

// ✅ signature content stream (auth-protected, but accessible to leave portal users)
router.get('/signatures/content/:fileId', requireAuth, leaveRecordUser.streamSignatureContent)


// ───────────────── Record / PDF data ─────────────────

// ✅ GET /api/leave/user/record?employeeId=...&contractId=...&asOf=...
router.get('/record', requireAuth, leaveRecordUser.getMyLeaveRecord)



module.exports = router
