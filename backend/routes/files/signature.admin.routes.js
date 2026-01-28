const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const router = express.Router()
const ctrl = require('../../controllers/files/signature.admin.controller')

// ───────── helpers ─────────
function safeName(v) {
  return String(v || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
}

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads')
const EMP_DIR = path.join(UPLOAD_DIR, 'signatures', 'employees')
const USER_DIR = path.join(UPLOAD_DIR, 'signatures', 'users')

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function fileFilter(_req, file, cb) {
  const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)
  if (!ok) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
  cb(null, true)
}

// ───────── multer storage ─────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const kind = String(req.params.kind || '').trim() // 'employees' or 'users'
    const dir = kind === 'employees' ? EMP_DIR : USER_DIR
    ensureDir(dir)
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const id = safeName(req.params.id)
    const ext = String(path.extname(file.originalname || '') || '.jpg').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
})

// ✅ accept both field names: "file" OR "signature"
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

// ✅ handle multer errors → return 400 instead of 500
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

// ───────── GET signature urls ─────────
router.get('/admin/signatures/employees/:employeeId', ctrl.getEmployeeSignature)
router.get('/admin/signatures/users/:loginId', ctrl.getUserSignature)

// ───────── Upload signature ─────────
// Frontend can POST:
//   /api/admin/signatures/employees/:employeeId
//   /api/admin/signatures/users/:loginId
router.post('/admin/signatures/:kind/:id', validateKind, (req, res, next) => {
  uploadAnySig(req, res, (err) => handleMulter(err, req, res, next))
}, ctrl.uploadSignature)

module.exports = router
