// backend/routes/leave/leaveReport-admin.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const leaveReportCtrl = require('../../controllers/leave/leaveReport.admin.controller')
const leaveRecordCtrl = require('../../controllers/leave/leaveRecord.admin.controller')

// Summary report
router.get(
  '/admin/leave/reports/summary',
  auth.requireAuth,
  auth.requireRole('LEAVE_ADMIN'),
  leaveReportCtrl.getLeaveReportSummary
)

// Per employee printable record
router.get(
  '/admin/leave/reports/employee/:employeeId/record',
  auth.requireAuth,
  auth.requireRole('LEAVE_ADMIN'),
  leaveRecordCtrl.getEmployeeLeaveRecord
)

module.exports = router
