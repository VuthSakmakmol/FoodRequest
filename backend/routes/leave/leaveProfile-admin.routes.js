// backend/routes/leave/leaveProfile-admin.routes.js
const express = require('express')
const router  = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const adminCtrl = require('../../controllers/leave/leaveProfile.admin.controller')

// ✅ Only leave admin (and optionally ROOT admin) can edit profiles.
// If later you want manager/GM to see the year sheet, you can relax
// the middleware just for that one route.
router.use(requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN'))

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

/**
 * GET /api/admin/leave/profiles/:employeeId/year-sheet
 * One-year leave history + dynamic balances
 */
router.get('/profiles/:employeeId/year-sheet', adminCtrl.getYearSheet)

module.exports = router
