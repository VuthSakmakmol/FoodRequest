const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../middlewares/auth')

const adminLeaveTypesCtrl = require('../controllers/leave/adminLeaveTypes.controller')
const adminProfileCtrl = require('../controllers/leave/leaveProfile.admin.controller')

// ✅ Admin types (DB or system)
router.get('/admin/leave/types', requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), adminLeaveTypesCtrl.list)

// Profiles (computed balances)
router.get('/admin/leave/profiles', requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), adminProfileCtrl.listProfiles)
router.get('/admin/leave/profiles/:employeeId', requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), adminProfileCtrl.adminGetProfile)
router.put('/admin/leave/profiles/:employeeId', requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), adminProfileCtrl.adminUpsertProfile)
router.get('/admin/leave/profiles/:employeeId/year-sheet', requireAuth, requireRole('LEAVE_ADMIN', 'LEAVE_MANAGER', 'LEAVE_GM', 'ADMIN', 'ROOT_ADMIN'), adminProfileCtrl.getYearSheet)

module.exports = router
