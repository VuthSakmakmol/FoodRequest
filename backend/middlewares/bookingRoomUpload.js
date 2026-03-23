const multer = require('multer')

function fileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Only JPG, JPEG, PNG, and WEBP files are allowed.'))
  }

  cb(null, true)
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
})

module.exports = upload