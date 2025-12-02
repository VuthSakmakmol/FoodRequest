// backend/routes/leave/leaveProfile-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const adminCtrl = require('../../controllers/leave/leaveProfile.admin.controller')

// ✅ Only LEAVE_ADMIN can use these endpoints
router.use(requireAuth, requireRole(['LEAVE_ADMIN']))

// List all expat leave profiles
router.get('/profiles', adminCtrl.listProfiles)

// Load single profile + employee info (if you use it later)
router.get('/profiles/:employeeId', adminCtrl.adminGetProfile)

// Create/update profile for one employee
router.put('/profiles/:employeeId', adminCtrl.adminUpsertProfile)

module.exports = router
