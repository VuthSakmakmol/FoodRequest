// backend/routes/leave/leaveYearSheet-admin.routes.js
const router = require('express').Router()
const { requireAuth, requireRole } = require('../../middlewares/auth')

const ctrl = require('../../controllers/leave/leaveYearSheet.admin.controller')

// Only admin can access
router.use(requireAuth, requireRole('LEAVE_ADMIN', 'ADMIN'))

// Get year sheet for employee
router.get('/year-sheets/:employeeId', ctrl.getYearSheet)

// Optional: force recompute (if you have this feature)
router.post('/year-sheets/:employeeId/recompute', ctrl.recomputeYearSheet)

// Optional: export excel (if you have this feature)
router.get('/year-sheets/:employeeId/export', ctrl.exportYearSheetXlsx)

module.exports = router
