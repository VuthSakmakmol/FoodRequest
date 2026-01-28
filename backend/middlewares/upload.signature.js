// backend/middlewares/upload.signature.js
const path = require('path')
const fs = require('fs')
const multer = require('multer')

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function extFromMime(mime) {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  return ''
}

function fileFilter(_req, file, cb) {
  const ok = ['image/png', 'image/jpeg'].includes(file.mimetype)
  if (!ok) return cb(new Error('Only PNG/JPG allowed'))
  cb(null, true)
}

function storageUsers() {
  const baseDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'signatures', 'users')
  ensureDir(baseDir)

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, baseDir),
    filename: (req, file, cb) => {
      const loginId = String(req.params.loginId || '').trim()
      const ext = extFromMime(file.mimetype) || path.extname(file.originalname) || '.png'
      cb(null, `${loginId}${ext.toLowerCase()}`)
    },
  })
}

function storageEmployees() {
  const baseDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'signatures', 'employees')
  ensureDir(baseDir)

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, baseDir),
    filename: (req, file, cb) => {
      const employeeId = String(req.params.employeeId || '').trim()
      const ext = extFromMime(file.mimetype) || path.extname(file.originalname) || '.png'
      cb(null, `${employeeId}${ext.toLowerCase()}`)
    },
  })
}

const uploadUserSig = multer({
  storage: storageUsers(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('signature')

const uploadEmployeeSig = multer({
  storage: storageEmployees(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('signature')

module.exports = { uploadUserSig, uploadEmployeeSig }
