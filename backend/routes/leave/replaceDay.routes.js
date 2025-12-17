// backend/routes/leave/replaceDay.routes.js
const express = require('express')
const multer = require('multer')

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/replaceDay.controller')

const router = express.Router()

/**
 * ✅ Memory uploader for Replace Day (store evidence in MongoDB)
 * - keep middlewares/upload.js unchanged (disk upload is used elsewhere)
 * - allow multiple files
 */
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB each
    files: 10,                  // max 10 files
  },
  fileFilter(_req, file, cb) {
    // allow PDF/JPG/PNG only
    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.originalname || '')) {
      return cb(new Error('Only PDF/JPG/PNG allowed'))
    }
    cb(null, true)
  },
})

/**
 * Endpoints (mounted e.g. at /api/leave/replace-days)
 * - Employee creates request
 * - Manager approves/rejects
 * - GM approves/rejects
 * - Employee can list/cancel their own
 */
router.post(
  '/',
  requireAuth,
  evidenceUpload.array('evidence', 10), // ✅ multiple evidence files
  ctrl.createMyReplaceDay
)

router.get('/my', requireAuth, ctrl.listMyReplaceDays)

router.patch('/:id/cancel', requireAuth, ctrl.cancelMyReplaceDay)

// Manager inbox + decision
router.get(
  '/manager/inbox',
  requireAuth,
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listManagerInbox
)

router.post(
  '/:id/manager-decision',
  requireAuth,
  requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.managerDecision
)

// GM inbox + decision
router.get(
  '/gm/inbox',
  requireAuth,
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listGmInbox
)

router.post(
  '/:id/gm-decision',
  requireAuth,
  requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.gmDecision
)

router.get('/:id/evidences/:evidenceId', requireAuth, ctrl.downloadEvidence)


module.exports = router
