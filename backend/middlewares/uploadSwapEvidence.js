// backend/middlewares/uploadSwapEvidence.js
const multer = require('multer')

const storage = multer.memoryStorage()

function fileFilter(req, file, cb) {
  const mimetype = String(file?.mimetype || '').toLowerCase()
  const ok = mimetype.includes('pdf') || mimetype.startsWith('image/')
  if (!ok) return cb(new Error('Only PDF and image files are allowed.'), false)
  return cb(null, true)
}

const swapEvidenceUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB each
    files: 10,
  },
})

module.exports = { swapEvidenceUpload }