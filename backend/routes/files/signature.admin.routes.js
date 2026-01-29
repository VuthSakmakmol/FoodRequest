// backend/routes/files/signature.admin.routes.js
const express = require('express')
const multer = require('multer')
const ctrl = require('../../controllers/files/signature.admin.controller')

const router = express.Router()

function fileFilter(_req, file, cb) {
  const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)
  if (!ok) return cb(new Error('Only PNG/JPG/WEBP allowed'))
  cb(null, true)
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
})

const uploadAnySig = upload.fields([
  { name: 'signature', maxCount: 1 },
  { name: 'file', maxCount: 1 },
])

function validateKind(req, res, next) {
  const kind = String(req.params.kind || '').trim()
  if (kind !== 'employees' && kind !== 'users') {
    return res.status(400).json({ message: 'Invalid kind. Use employees or users.' })
  }
  next()
}

function runUpload(req, res, next) {
  uploadAnySig(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ message: err.message || 'Upload failed' })
  })
}

// meta (NO 404 spam)
router.get('/admin/signatures/employees/:employeeId', ctrl.getEmployeeSignature)
router.get('/admin/signatures/users/:loginId', ctrl.getUserSignature)

// stream the image from MongoDB (GridFS)
router.get('/admin/signatures/:kind/:id/content', validateKind, ctrl.streamSignature)

// Vue endpoints (exact)
router.post('/admin/signatures/users/:loginId', (req, _res, next) => {
  req.params.kind = 'users'
  req.params.id = req.params.loginId
  next()
}, runUpload, ctrl.uploadSignature)

router.post('/admin/signatures/employees/:employeeId', (req, _res, next) => {
  req.params.kind = 'employees'
  req.params.id = req.params.employeeId
  next()
}, runUpload, ctrl.uploadSignature)

// optional delete
router.delete('/admin/signatures/:kind/:id', validateKind, ctrl.deleteSignature)

module.exports = router
