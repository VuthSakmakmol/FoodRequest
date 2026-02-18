/* eslint-disable no-console */
// backend/routes/leave/swapWorkingDay.routes.js
//
// Base mount: /api/leave  (see server.js)
// Endpoints:
//  POST   /swap-working-day
//  GET    /swap-working-day/my
//  POST   /swap-working-day/:id/cancel
//  GET    /swap-working-day/manager/inbox?scope=ALL
//  POST   /swap-working-day/:id/manager-decision
//  GET    /swap-working-day/gm/inbox?scope=ALL
//  POST   /swap-working-day/:id/gm-decision
//  GET    /swap-working-day/coo/inbox?scope=ALL
//  POST   /swap-working-day/:id/coo-decision
//  GET    /swap-working-day/admin?employeeId=...&status=...&from=...&to=...&limit=...
//  GET    /swap-working-day/:id

const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/swapWorkingDay.controller')

// ✅ all endpoints require login (LEAVE_USER / approvers / admins)
router.use(requireAuth)

/* ─────────────────────────────────────────────
   EMPLOYEE (LEAVE_USER)
───────────────────────────────────────────── */

// Create new swap working day request
router.post('/swap-working-day', requireRole('LEAVE_USER'), ctrl.createMySwapRequest)

// List my swap requests
router.get('/swap-working-day/my', requireRole('LEAVE_USER'), ctrl.listMySwapRequests)

// Cancel my swap request (only if still pending)
router.post('/swap-working-day/:id/cancel', requireRole('LEAVE_USER'), ctrl.cancelMySwapRequest)

/* ─────────────────────────────────────────────
   MANAGER
───────────────────────────────────────────── */

// Manager inbox (pending only by default; scope=ALL for history)
// Admin viewers can also view
router.get(
  '/swap-working-day/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listManagerInbox
)

// Manager decision
router.post(
  '/swap-working-day/:id/manager-decision',
  requireRole('LEAVE_MANAGER'),
  ctrl.managerDecision
)

/* ─────────────────────────────────────────────
   GM
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listGmInbox
)

router.post('/swap-working-day/:id/gm-decision', requireRole('LEAVE_GM'), ctrl.gmDecision)

/* ─────────────────────────────────────────────
   COO
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listCooInbox
)

router.post('/swap-working-day/:id/coo-decision', requireRole('LEAVE_COO'), ctrl.cooDecision)

/* ─────────────────────────────────────────────
   ADMIN (VIEW/SEARCH)
───────────────────────────────────────────── */

// Admin list/search (view only)
router.get(
  '/swap-working-day/admin',
  requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.adminList
)

// Admin read one (view only)
router.get(
  '/swap-working-day/:id',
  requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_USER'),
  ctrl.getOne
)

module.exports = router