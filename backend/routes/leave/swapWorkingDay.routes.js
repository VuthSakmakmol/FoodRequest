// backend/routes/leave/swapWorkingDayRequest.routes.js
const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const swapCtrl = require('../../controllers/leave/swapWorkingDay.controller')

router.use(requireAuth)

/* ─────────────────────────────────────────────
   EMPLOYEE (LEAVE_USER)
───────────────────────────────────────────── */
router.post('/swap-working-day', requireRole('LEAVE_USER'), swapCtrl.createMySwapRequest)
router.get('/swap-working-day/my', requireRole('LEAVE_USER'), swapCtrl.listMySwapRequests)
router.put('/swap-working-day/:id', requireRole('LEAVE_USER'), swapCtrl.updateMySwapRequest)
router.post('/swap-working-day/:id/cancel', requireRole('LEAVE_USER'), swapCtrl.cancelMySwapRequest)

/* ─────────────────────────────────────────────
   MANAGER
───────────────────────────────────────────── */
router.get(
  '/swap-working-day/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listManagerInbox
)
router.post('/swap-working-day/:id/manager-decision', requireRole('LEAVE_MANAGER'), swapCtrl.managerDecision)

/* ─────────────────────────────────────────────
   GM
───────────────────────────────────────────── */
router.get(
  '/swap-working-day/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listGmInbox
)
router.post('/swap-working-day/:id/gm-decision', requireRole('LEAVE_GM'), swapCtrl.gmDecision)

/* ─────────────────────────────────────────────
   COO
───────────────────────────────────────────── */
router.get(
  '/swap-working-day/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listCooInbox
)
router.post('/swap-working-day/:id/coo-decision', requireRole('LEAVE_COO'), swapCtrl.cooDecision)

/* ─────────────────────────────────────────────
   ADMIN (VIEW)
───────────────────────────────────────────── */
router.get('/swap-working-day/admin', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), swapCtrl.adminList)
router.delete('/swap-working-day/admin/:id', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), swapCtrl.adminDelete)
// POST fallback is kept because some reverse proxies / browsers are stricter with DELETE.
router.post('/swap-working-day/admin/:id/delete', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), swapCtrl.adminDelete)
// Backward-compatible short alias.
router.delete('/swap-day/admin/:id', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), swapCtrl.adminDelete)
router.post('/swap-day/admin/:id/delete', requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), swapCtrl.adminDelete)

/* ─────────────────────────────────────────────
   GET ONE (LAST)
───────────────────────────────────────────── */
router.get(
  '/swap-working-day/:id',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.getOne
)


/* ─────────────────────────────────────────────
   MANAGER
───────────────────────────────────────────── */
router.post(
  '/swap-working-day/manager/bulk-decision',
  requireRole('LEAVE_MANAGER'),
  swapCtrl.managerBulkDecision
)

/* ─────────────────────────────────────────────
   GM
───────────────────────────────────────────── */
router.post(
  '/swap-working-day/gm/bulk-decision',
  requireRole('LEAVE_GM'),
  swapCtrl.gmBulkDecision
)

/* ─────────────────────────────────────────────
   COO
───────────────────────────────────────────── */
router.post(
  '/swap-working-day/coo/bulk-decision',
  requireRole('LEAVE_COO'),
  swapCtrl.cooBulkDecision
)

module.exports = router