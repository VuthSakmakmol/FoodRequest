/* eslint-disable no-console */
// backend/routes/leave/swapWorkingDay.routes.js
//
// Base mount: /api/leave  (see server.js)
//
// Endpoints:
//  POST   /swap-working-day
//  GET    /swap-working-day/my
//  POST   /swap-working-day/:id/cancel
//
//  POST   /swap-working-day/:id/evidence
//  GET    /swap-working-day/:id/evidence/:fileId
//  DELETE /swap-working-day/:id/evidence/:fileId
//
//  GET    /swap-working-day/manager/inbox?scope=ALL
//  POST   /swap-working-day/:id/manager-decision
//
//  GET    /swap-working-day/gm/inbox?scope=ALL
//  POST   /swap-working-day/:id/gm-decision
//
//  GET    /swap-working-day/coo/inbox?scope=ALL
//  POST   /swap-working-day/:id/coo-decision
//
//  GET    /swap-working-day/admin?employeeId=&status=&from=&to=&limit=
//  GET    /swap-working-day/:id

const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')

const swapCtrl = require('../../controllers/leave/swapWorkingDay.controller')
const evidenceCtrl = require('../../controllers/leave/swapWorkingDay.evidence.controller')

const multer = require('multer')

/* ─────────────────────────────────────────────
   Multer config (memory storage, 5MB limit)
───────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
})

/* ─────────────────────────────────────────────
   All endpoints require login
───────────────────────────────────────────── */
router.use(requireAuth)

/* ─────────────────────────────────────────────
   EMPLOYEE (LEAVE_USER)
───────────────────────────────────────────── */

// Create new swap working day request
router.post(
  '/swap-working-day',
  requireRole('LEAVE_USER'),
  swapCtrl.createMySwapRequest
)

// List my swap requests
router.get(
  '/swap-working-day/my',
  requireRole('LEAVE_USER'),
  swapCtrl.listMySwapRequests
)

// Cancel my swap request
router.post(
  '/swap-working-day/:id/cancel',
  requireRole('LEAVE_USER'),
  swapCtrl.cancelMySwapRequest
)

/* ─────────────────────────────────────────────
   EVIDENCE (GridFS)
   ⚠ MUST BE ABOVE "/:id" ROUTE
───────────────────────────────────────────── */

// Upload evidence
router.post(
  '/swap-working-day/:id/evidence',
  requireRole('LEAVE_USER'),
  upload.single('file'),
  evidenceCtrl.uploadEvidence
)

// Get evidence content (blob preview)
router.get(
  '/swap-working-day/:id/evidence/:fileId',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_COO',
    'LEAVE_ADMIN',
    'ADMIN',
    'ROOT_ADMIN'
  ),
  evidenceCtrl.getEvidenceContent
)

// Delete evidence
router.delete(
  '/swap-working-day/:id/evidence/:fileId',
  requireRole('LEAVE_USER'),
  evidenceCtrl.deleteEvidence
)

/* ─────────────────────────────────────────────
   MANAGER
───────────────────────────────────────────── */

// Manager inbox (pending only by default; scope=ALL for history)
router.get(
  '/swap-working-day/manager/inbox',
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listManagerInbox
)

// Manager decision
router.post(
  '/swap-working-day/:id/manager-decision',
  requireRole('LEAVE_MANAGER'),
  swapCtrl.managerDecision
)

/* ─────────────────────────────────────────────
   GM
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/gm/inbox',
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listGmInbox
)

router.post(
  '/swap-working-day/:id/gm-decision',
  requireRole('LEAVE_GM'),
  swapCtrl.gmDecision
)

/* ─────────────────────────────────────────────
   COO
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/coo/inbox',
  requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.listCooInbox
)

router.post(
  '/swap-working-day/:id/coo-decision',
  requireRole('LEAVE_COO'),
  swapCtrl.cooDecision
)

/* ─────────────────────────────────────────────
   ADMIN (VIEW / SEARCH ONLY)
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/admin',
  requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.adminList
)

/* ─────────────────────────────────────────────
   GET ONE (Owner / Approver / Admin)
   ⚠ MUST BE LAST
───────────────────────────────────────────── */

router.get(
  '/swap-working-day/:id',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_COO',
    'LEAVE_ADMIN',
    'ADMIN',
    'ROOT_ADMIN'
  ),
  swapCtrl.getOne
)

module.exports = router