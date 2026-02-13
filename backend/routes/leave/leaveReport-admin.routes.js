// backend/routes/leave/leaveReport-admin.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const leaveReportCtrl = require('../../controllers/leave/leaveReport.admin.controller')
const leaveRecordCtrl = require('../../controllers/leave/leaveRecord.admin.controller')

// ✅ one guard for this router (admin-only)
router.use(auth.requireAuth)
router.use(auth.requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'))

// Summary report
// FINAL URL: /api/admin/leave/reports/summary
router.get('/reports/summary', leaveReportCtrl.getLeaveReportSummary)

// Per employee printable record
// FINAL URL: /api/admin/leave/reports/employee/:employeeId/record
router.get('/reports/employee/:employeeId/record', leaveRecordCtrl.getEmployeeLeaveRecord)

module.exports = router