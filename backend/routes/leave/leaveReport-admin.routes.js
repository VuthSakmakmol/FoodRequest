// backend/routes/leave/leaveReport-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const { getLeaveReportSummary } = require('../../controllers/leave/leaveReport.admin.controller')

router.get(
  '/admin/leave/reports/summary',
  requireAuth,
  requireRole('LEAVE_ADMIN', 'ADMIN'),
  getLeaveReportSummary
)

module.exports = router
