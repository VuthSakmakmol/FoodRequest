// backend/routes/files/signature.admin.routes.js
const express = require('express')
const multer = require('multer')

const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/files/signature.admin.controller')

const router = express.Router()

function fileFilter(_req, file, cb) {
  const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)
  if (!ok) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
  cb(null, true)
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
})

// accept both field names: "file" OR "signature"
const uploadAnySig = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
])

function validateKind(req, res, next) {
  const kind = String(req.params.kind || '').trim()
  if (kind !== 'employees' && kind !== 'users') {
    return res.status(400).json({ message: 'Invalid kind. Use employees or users.' })
  }
  next()
}

function handleMulter(err, _req, res, next) {
  if (!err) return next()
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large (max 2MB).'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected field "${err.field}". Use "file" or "signature".`
          : err.message || 'Upload error.'
    return res.status(400).json({ message: msg })
  }
  return res.status(400).json({ message: err.message || 'Upload error.' })
}

/**
 * Mounted at /api (server.js)
 * So final paths are:
 * GET  /api/admin/signatures/employees/:employeeId
 * GET  /api/admin/signatures/users/:loginId
 * GET  /api/admin/signatures/:kind/:id/view
 * POST /api/admin/signatures/:kind/:id
 */
router.use(auth.requireAuth)

// JSON url endpoints
router.get('/admin/signatures/employees/:employeeId', ctrl.getEmployeeSignature)
router.get('/admin/signatures/users/:loginId', ctrl.getUserSignature)

// View (stream)
router.get('/admin/signatures/:kind/:id/view', validateKind, ctrl.viewSignature)

// Upload (LEAVE_ADMIN only)
router.post(
  '/admin/signatures/:kind/:id',
  auth.requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  validateKind,
  (req, res, next) => {
    uploadAnySig(req, res, (err) => handleMulter(err, req, res, next))
  },
  ctrl.uploadSignature
)

module.exports = router
