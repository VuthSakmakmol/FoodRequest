const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const { listCooInbox } = require('../../controllers/leave/leaveRequests.coo.controller')

router.use(requireAuth)

router.get(
  '/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  listCooInbox
)

module.exports = router
