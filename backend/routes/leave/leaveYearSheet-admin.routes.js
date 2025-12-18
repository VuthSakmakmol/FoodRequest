// backend/routes/leave/leaveYearSheet-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.admin.controller')

router.use(requireAuth)
router.use(requireRole('LEAVE_ADMIN', 'ADMIN'))

router.get('/profiles/:employeeId/year-sheet', ctrl.getYearSheet)

module.exports = router
