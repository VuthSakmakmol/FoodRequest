// backend/routes/leave/leaveProfile-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.admin.controller')

router.use(requireAuth)
router.use(requireRole('LEAVE_ADMIN', 'ADMIN'))

router.get('/profiles', ctrl.listProfiles)
router.get('/profiles/:employeeId', ctrl.adminGetProfile)
router.put('/profiles/:employeeId', ctrl.adminUpsertProfile)

module.exports = router
