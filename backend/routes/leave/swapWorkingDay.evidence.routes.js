// backend/routes/leave/swapWorkingDay.evidence.routes.js
const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/swapWorkingDay.evidence.controller')
const { swapEvidenceUpload } = require('../../middlewares/uploadSwapEvidence')

router.use(requireAuth)

// ✅ list metadata
router.get(
  '/swap-working-day/:id/evidence',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listEvidence
)

// ✅ upload multi files: key = "files"
router.post(
  '/swap-working-day/:id/evidence',
  requireRole('LEAVE_USER'),
  swapEvidenceUpload.array('files', 10),
  ctrl.uploadEvidence
)

// ✅ stream preview (inline)
router.get(
  '/swap-working-day/:id/evidence/:attId/content',
  requireRole('LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.getEvidenceContent
)

// ✅ delete
router.delete(
  '/swap-working-day/:id/evidence/:attId',
  requireRole('LEAVE_USER'),
  ctrl.deleteEvidence
)

module.exports = router