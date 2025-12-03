// backend/routes/leave/leaveProfile-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const adminCtrl = require('../../controllers/leave/leaveProfile.admin.controller')

// ✅ Only LEAVE_ADMIN can use these endpoints
router.use(requireAuth, requireRole('LEAVE_ADMIN'))

/**
 * GET /api/admin/leave/profiles
 * List all expat leave profiles
 */
router.get('/profiles', adminCtrl.listProfiles)

/**
 * GET /api/admin/leave/profiles/:employeeId
 * Load employee + profile data
 */
router.get('/profiles/:employeeId', adminCtrl.adminGetProfile)

/**
 * PUT /api/admin/leave/profiles/:employeeId
 * Create/update profile for one employee
 */
router.put('/profiles/:employeeId', adminCtrl.adminUpsertProfile)

module.exports = router
