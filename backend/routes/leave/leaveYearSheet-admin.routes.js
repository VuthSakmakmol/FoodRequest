// backend/routes/leave/leaveYearSheet-admin.routes.js
const express = require('express')
const router  = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const yearSheetCtrl = require('../../controllers/leave/leaveYearSheet.controller')

// allow admin + manager + GM to view
router.use(requireAuth, requireRole('LEAVE_ADMIN', 'LEAVE_MANAGER', 'LEAVE_GM', 'ADMIN'))

// GET /api/admin/leave/profiles/:employeeId/year-sheet
router.get('/profiles/:employeeId/year-sheet', yearSheetCtrl.getEmployeeYearSheet)

module.exports = router
