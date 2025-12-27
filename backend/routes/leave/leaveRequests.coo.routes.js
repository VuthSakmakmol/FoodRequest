// backend/routes/leave/leaveRequests.coo.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const { listCooInbox, cooDecision } = require('../../controllers/leave/leaveRequests.coo.controller')

router.use(requireAuth)

router.get(
  '/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  listCooInbox
)

router.post(
  '/:id/coo-decision',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  cooDecision
)

module.exports = router
