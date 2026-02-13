// backend/routes/leave/leaveRequest.routes.js
const router = require('express').Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRequest.controller')

const multer = require('multer')
const att = require('../../controllers/leave/leaveRequest.attachments.controller')

// ✅ everyone must be authenticated
router.use(requireAuth)

/* ───────────────── upload config ───────────────── */
function fileFilter(_req, file, cb) {
  const ok = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(String(file.mimetype || '').toLowerCase())

  if (!ok) return cb(new Error('File type not allowed'))
  cb(null, true)
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB each
})

function runUpload(req, res, next) {
  upload.array('files', 10)(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ message: err.message || 'Upload failed' })
  })
}

/* ───────────────── attachments (optional evidence) ─────────────────
   ✅ READ: everyone with any leave role + admin roles
   ✅ WRITE: still same roles, but controller enforces owner-only CRUD
*/
const READ_ROLES = ['LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN']
const WRITE_ROLES = ['LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN']

router.get('/:id/attachments', requireRole(...READ_ROLES), att.list)

router.get('/:id/attachments/:attId/content', requireRole(...READ_ROLES), att.stream)

// ✅ only requester can upload/delete (controller enforces owner-only)
router.post('/:id/attachments', requireRole(...WRITE_ROLES), runUpload, att.uploadMany)

router.delete('/:id/attachments/:attId', requireRole(...WRITE_ROLES), att.remove)

/* ───────────────── employee requests ───────────────── */
router.post('/', requireRole(...WRITE_ROLES), ctrl.createMyRequest)

router.get('/my', requireRole(...READ_ROLES), ctrl.listMyRequests)

router.post('/:id/cancel', requireRole(...WRITE_ROLES), ctrl.cancelMyRequest)

/* ───────────────── manager ───────────────── */
router.get('/manager/inbox', requireRole('LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.listManagerInbox)

router.post('/:id/manager-decision', requireRole('LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.managerDecision)

/* ───────────────── gm ───────────────── */
router.get('/gm/inbox', requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.listGmInbox)

router.post('/:id/gm-decision', requireRole('LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.gmDecision)

/* ───────────────── coo ───────────────── */
router.get('/coo/inbox', requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.listCooInbox)

router.post('/:id/coo-decision', requireRole('LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'), ctrl.cooDecision)

/* ───────────────── patch (edit request) ───────────────── */
router.patch('/:id', requireRole(...WRITE_ROLES), ctrl.updateMyRequest)

module.exports = router