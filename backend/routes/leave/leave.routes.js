// backend/routes/leave/leave.routes.js
const router = require('express').Router()
const { requireAuth, requireRole } = require('../../middlewares/auth')

const ctrl = require('../../controllers/leave/leaveRequest.controller')

// User actions
router.get('/my', requireAuth, requireRole('LEAVE_USER','LEAVE_MANAGER','LEAVE_GM','LEAVE_ADMIN','ADMIN'), ctrl.listMyRequests)
router.post('/', requireAuth, requireRole('LEAVE_USER','LEAVE_MANAGER','LEAVE_GM','LEAVE_ADMIN','ADMIN'), ctrl.createMyRequest)
router.put('/:id/cancel', requireAuth, requireRole('LEAVE_USER','LEAVE_MANAGER','LEAVE_GM','LEAVE_ADMIN','ADMIN'), ctrl.cancelMyRequest)

// Manager
router.get('/manager/inbox', requireAuth, requireRole('LEAVE_MANAGER','LEAVE_ADMIN','ADMIN'), ctrl.listManagerInbox)
router.put('/:id/manager-decision', requireAuth, requireRole('LEAVE_MANAGER','LEAVE_ADMIN','ADMIN'), ctrl.managerDecision)

// GM
router.get('/gm/inbox', requireAuth, requireRole('LEAVE_GM','LEAVE_ADMIN','ADMIN'), ctrl.listGmInbox)
router.put('/:id/gm-decision', requireAuth, requireRole('LEAVE_GM','LEAVE_ADMIN','ADMIN'), ctrl.gmDecision)

module.exports = router
