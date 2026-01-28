const fs = require('fs')
const path = require('path')

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads')
const EMP_DIR = path.join(UPLOAD_DIR, 'signatures', 'employees')
const USER_DIR = path.join(UPLOAD_DIR, 'signatures', 'users')

const EXT = ['.png', '.jpg', '.jpeg', '.webp']

function safeText(v) {
  return String(v ?? '').trim()
}

function baseUrl(req) {
  const proto =
    req.headers['x-forwarded-proto']?.split(',')[0]?.trim() ||
    (req.secure ? 'https' : 'http')
  return `${proto}://${req.get('host')}`
}

function findById(dir, id) {
  const name = safeText(id)
  if (!name) return null

  // if already has extension
  if (/\.[a-z0-9]+$/i.test(name)) {
    const full = path.join(dir, name)
    return fs.existsSync(full) ? name : null
  }

  for (const ext of EXT) {
    const file = name + ext
    if (fs.existsSync(path.join(dir, file))) return file
  }
  return null
}

// ✅ accept multer.single OR multer.fields
function pickUploadedFile(req) {
  // multer.single(...)
  if (req.file) return req.file

  // multer.fields(...)
  const f1 = req.files?.file?.[0]
  if (f1) return f1
  const f2 = req.files?.signature?.[0]
  if (f2) return f2

  return null
}

exports.getEmployeeSignature = (req, res) => {
  const employeeId = safeText(req.params.employeeId)
  const file = findById(EMP_DIR, employeeId)
  if (!file) return res.status(404).json({ signatureUrl: '' })

  return res.json({
    signatureUrl: `${baseUrl(req)}/uploads/signatures/employees/${encodeURIComponent(file)}`,
  })
}

exports.getUserSignature = (req, res) => {
  const loginId = safeText(req.params.loginId)
  const file = findById(USER_DIR, loginId)
  if (!file) return res.status(404).json({ signatureUrl: '' })

  return res.json({
    signatureUrl: `${baseUrl(req)}/uploads/signatures/users/${encodeURIComponent(file)}`,
  })
}

exports.uploadSignature = (req, res) => {
  const kind = safeText(req.params.kind) // employees/users
  const id = safeText(req.params.id)

  const file = pickUploadedFile(req)
  if (!file) return res.status(400).json({ message: 'No file uploaded' })

  const url =
    kind === 'employees'
      ? `${baseUrl(req)}/uploads/signatures/employees/${encodeURIComponent(file.filename)}`
      : `${baseUrl(req)}/uploads/signatures/users/${encodeURIComponent(file.filename)}`

  return res.json({
    ok: true,
    kind,
    id,
    signatureUrl: url,
    filename: file.filename,
  })
}
