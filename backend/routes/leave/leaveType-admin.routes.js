// backend/routes/leave/leaveType-admin.routes.js
const router = require('express').Router()
const { requireAuth, requireRole } = require('../../middlewares/auth')
const { listAdminLeaveTypes } = require('../../controllers/leave/leaveType.controller')

router.get('/', requireAuth, requireRole('ADMIN', 'LEAVE_ADMIN'), listAdminLeaveTypes)

module.exports = router
