const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const leaveCtrl = require('../../controllers/leave/leaveRequest.controller')

// All COO leave routes require auth
router.use(requireAuth)

/**
 * COO Inbox
 * GET /api/coo/leave/requests/inbox
 */
router.get(
  '/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  leaveCtrl.listCooInbox
)

/**
 * COO Decision
 * POST /api/coo/leave/requests/:id/decision
 * body: { action: "APPROVE"|"REJECT", comment?: string }
 */
router.post(
  '/:id/decision',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  leaveCtrl.cooDecision
)

module.exports = router
