/* eslint-disable no-console */
// backend/routes/leave/swapWorkingDay.routes.js

const router = require('express').Router()
const multer = require('multer')

const { requireAuth, requireRole } = require('../../middlewares/auth')

const swapCtrl = require('../../controllers/leave/swapWorkingDay.controller')
const evidenceCtrl = require('../../controllers/leave/swapWorkingDay.evidence.controller')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

router.use(requireAuth)

/* ─────────────────────────────────────────────
   EMPLOYEE (LEAVE_USER)
───────────────────────────────────────────── */
router.post('/swap-working-day', requireRole('LEAVE_USER'), swapCtrl.createMySwapRequest)
router.get('/swap-working-day/my', requireRole('LEAVE_USER'), swapCtrl.listMySwapRequests)

// ✅ NEW: update (edit) while pending
router.put('/swap-working-day/:id', requireRole('LEAVE_USER'), swapCtrl.updateMySwapRequest)

router.post('/swap-working-day/:id/cancel', requireRole('LEAVE_USER'), swapCtrl.cancelMySwapRequest)

/* ─────────────────────────────────────────────
   EVIDENCE (GridFS)  ✅ must be above "/:id"
───────────────────────────────────────────── */

// list attachments meta
router.get(
  '/swap-working-day/:id/evidence',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  evidenceCtrl.listEvidence
)

// upload multiple (files[])
router.post(
  '/swap-working-day/:id/evidence',
  requireRole('LEAVE_USER'),
  upload.array('files', 10),
  evidenceCtrl.uploadEvidence
)

// stream content
router.get(
  '/swap-working-day/:id/evidence/:attId/content',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  evidenceCtrl.getEvidenceContent
)

// delete by attId
router.delete(
  '/swap-working-day/:id/evidence/:attId',
  requireRole('LEAVE_USER'),
  evidenceCtrl.deleteEvidence
)

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

/* ─────────────────────────────────────────────
   GET ONE (LAST)
───────────────────────────────────────────── */
router.get(
  '/swap-working-day/:id',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  swapCtrl.getOne
)

module.exports = router