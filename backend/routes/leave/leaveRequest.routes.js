const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRequest.controller')

router.use(requireAuth)

/* employee (any leave role can request their own leave) */
router.post(
  '/',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.createMyRequest
)

router.get(
  '/my',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listMyRequests
)

router.post(
  '/:id/cancel',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.cancelMyRequest
)

/* manager */
router.get(
  '/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listManagerInbox
)

router.post(
  '/:id/manager-decision',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.managerDecision
)

/* gm */
router.get(
  '/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listGmInbox
)

router.post(
  '/:id/gm-decision',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.gmDecision
)

module.exports = router
