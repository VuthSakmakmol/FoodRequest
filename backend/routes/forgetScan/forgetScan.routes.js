/* eslint-disable no-console */
// backend/routes/forgetScan/forgetScan.routes.js
//
// ✅ ExpatForgetScan routes
// ✅ Base mount: /api/leave
//
// Final paths:
//  POST   /api/leave/forget-scan
//  GET    /api/leave/forget-scan/my
//  POST   /api/leave/forget-scan/:id/cancel
//  PATCH  /api/leave/forget-scan/:id
//  GET    /api/leave/forget-scan/manager/inbox?scope=ALL
//  POST   /api/leave/forget-scan/:id/manager-decision
//  GET    /api/leave/forget-scan/gm/inbox?scope=ALL
//  POST   /api/leave/forget-scan/:id/gm-decision
//  GET    /api/leave/forget-scan/coo/inbox?scope=ALL
//  POST   /api/leave/forget-scan/:id/coo-decision        ✅ ADD
//  GET    /api/leave/forget-scan/admin?employeeId=&status=&from=&to=&limit=&skip=
//  GET    /api/leave/forget-scan/:id

const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/forgetScan/forgetScan.controller')

// ✅ all endpoints require login
router.use(requireAuth)

/* ───────────────── Employee ───────────────── */

// create
router.post(
  '/forget-scan',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.createMyForgetScan
)

// list my
router.get(
  '/forget-scan/my',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listMyForgetScans
)

// cancel (controller enforces owner OR admin viewer)
router.post(
  '/forget-scan/:id/cancel',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.cancelMyForgetScan
)

// edit my request (owner only; controller enforces)
router.patch(
  '/forget-scan/:id',
  requireRole('LEAVE_USER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.updateMyForgetScan
)

/* ───────────────── Inboxes + decisions ───────────────── */

// manager inbox (manager + admin viewer)
router.get(
  '/forget-scan/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listManagerInbox
)

// manager decision (NO admin bypass)
router.post('/forget-scan/:id/manager-decision', requireRole('LEAVE_MANAGER'), ctrl.managerDecision)

// gm inbox (gm + admin viewer)
router.get(
  '/forget-scan/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listGmInbox
)

// gm decision (NO admin bypass)
router.post('/forget-scan/:id/gm-decision', requireRole('LEAVE_GM'), ctrl.gmDecision)

// coo inbox (coo + admin viewer)
router.get(
  '/forget-scan/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listCooInbox
)

// ✅ coo decision (NO admin bypass)  <-- REQUIRED for GM_AND_COO / MANAGER_AND_COO final step
router.post('/forget-scan/:id/coo-decision', requireRole('LEAVE_COO'), ctrl.cooDecision)

/* ───────────────── Admin viewer ───────────────── */

router.get('/forget-scan/admin', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.adminList)

/* ───────────────── Detail (viewer) ─────────────────
   owner / assigned approver / admin viewer can view.
   Controller validates permission.
───────────────────────────────────────────────────── */
router.get(
  '/forget-scan/:id',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_COO',
    'LEAVE_ADMIN',
    'ADMIN',
    'ROOT_ADMIN'
  ),
  ctrl.getOne
)

module.exports = router