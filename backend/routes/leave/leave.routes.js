// backend/routes/leave/leave.routes.js
const express = require('express')
const router  = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRequest.controller')

// 🔊 Debug on startup so we know this file is loaded
console.log('[leave routes] ctrl keys:', Object.keys(ctrl))

// ─────────────────────────────────────────────
// All routes here require a logged-in user
// Base mount (example):
//   app.use('/api/leave/requests', router)
// ─────────────────────────────────────────────
router.use(requireAuth)

/**
 * POST /                (create new leave request)
 * Allowed: LEAVE_USER (expat), LEAVE_ADMIN, ADMIN
 */
router.post(
  '/',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN'),
  (req, res, next) => {
    console.log('➡️  [leave] POST /api/leave/requests hit')
    next()
  },
  ctrl.createMyRequest
)

/**
 * GET /my               (list my own requests)
 * Allowed: any leave-related role + admin
 */
router.get(
  '/my',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'ADMIN'
  ),
  (req, res, next) => {
    console.log('➡️  [leave] GET /api/leave/requests/my hit')
    next()
  },
  ctrl.listMyRequests
)

/**
 * PATCH /:id/cancel     (cancel my own request)
 */
router.patch(
  '/:id/cancel',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN'),
  (req, res, next) => {
    console.log('➡️  [leave] PATCH /api/leave/requests/:id/cancel hit', { id: req.params.id })
    next()
  },
  ctrl.cancelMyRequest
)

/**
 * GET /manager/inbox    (manager inbox)
 */
router.get(
  '/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  (req, res, next) => {
    console.log('➡️  [leave] GET /api/leave/requests/manager/inbox hit')
    next()
  },
  ctrl.listManagerInbox
)

/**
 * POST /:id/manager-decision   (approve / reject as Manager)
 */
router.post(
  '/:id/manager-decision',
  requireRole('LEAVE_MANAGER'),
  (req, res, next) => {
    console.log('➡️  [leave] POST /api/leave/requests/:id/manager-decision hit', {
      id: req.params.id,
      body: req.body,
    })
    next()
  },
  ctrl.managerDecision
)

/**
 * GET /gm/inbox         (GM inbox)
 */
router.get(
  '/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  (req, res, next) => {
    console.log('➡️  [leave] GET /api/leave/requests/gm/inbox hit')
    next()
  },
  ctrl.listGmInbox
)

/**
 * POST /:id/gm-decision       (approve / reject as GM)
 */
router.post(
  '/:id/gm-decision',
  requireRole('LEAVE_GM'),
  (req, res, next) => {
    console.log('➡️  [leave] POST /api/leave/requests/:id/gm-decision hit', {
      id: req.params.id,
      body: req.body,
    })
    next()
  },
  ctrl.gmDecision
)

module.exports = router
