// backend/middlewares/upload.js
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const uploadDir = process.env.UPLOAD_DIR || 'uploads'
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

function safe(str = '') {
  return String(str).toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}

function pickFromBody(req) {
  let category = req.body?.category || ''
  let tripDate = req.body?.tripDate || ''
  let employeeId = req.body?.employeeId || ''
  if ((!category || !tripDate || !employeeId) && req.body?.data) {
    try {
      const parsed = JSON.parse(req.body.data)
      category   = category   || parsed.category
      tripDate   = tripDate   || parsed.tripDate
      employeeId = employeeId || parsed.employeeId
    } catch {}
  }
  const cat = (category || '').toLowerCase() === 'messenger'
    ? 'messenger'
    : ((category || '').toLowerCase() === 'car' ? 'car' : 'file')
  const dateCompact = /^\d{4}-\d{2}-\d{2}$/.test(tripDate) ? tripDate.replace(/-/g, '') : ''
  return { cat, dateCompact, employeeId: employeeId ? safe(employeeId) : '' }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.resolve(uploadDir)),
  filename: (req, file, cb) => {
    const ts = Date.now()
    const { cat, dateCompact, employeeId } = pickFromBody(req)
    const originalSafe = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') : 'upload'
    const name = [cat || 'file', dateCompact || 'nodate', employeeId || 'noemp', String(ts)].join('_')
    cb(null, `${name}_${originalSafe}`)
  }
})

const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.originalname)) {
      return cb(new Error('Only PDF/JPG/PNG allowed'))
    }
    cb(null, true)
  },
  limits: { fileSize: 10 * 1024 * 1024 }
})

module.exports = { upload }
