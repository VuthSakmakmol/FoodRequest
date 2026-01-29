// backend/controllers/files/signature.admin.controller.js
/* eslint-disable no-console */
const mongoose = require('mongoose')
const { Readable } = require('stream')

const EXT_OK = new Set(['image/png', 'image/jpeg', 'image/webp'])

function s(v) {
  return String(v ?? '').trim()
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map((x) => s(x).toUpperCase()))].filter(Boolean)
}

function isSignatureViewer(req) {
  const roles = getRoles(req)
  return (
    roles.includes('ROOT_ADMIN') ||
    roles.includes('ADMIN') ||
    roles.includes('LEAVE_ADMIN') ||
    roles.includes('LEAVE_MANAGER') ||
    roles.includes('LEAVE_GM') ||
    roles.includes('LEAVE_COO')
  )
}

// multer.single('file') OR multer.fields({ file/signature })
function pickUploadedFile(req) {
  if (req.file) return req.file
  const f1 = req.files?.file?.[0]
  if (f1) return f1
  const f2 = req.files?.signature?.[0]
  if (f2) return f2
  return null
}

function getBucket() {
  const db = mongoose.connection?.db
  if (!db) throw new Error('MongoDB not connected')
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'signatures' })
}

async function deleteExisting(bucket, kind, id) {
  const files = await bucket
    .find({ 'metadata.kind': kind, 'metadata.ownerId': id })
    .sort({ uploadDate: -1 })
    .toArray()

  // keep none (we replace)
  for (const f of files || []) {
    try {
      await bucket.delete(f._id)
    } catch (_) {}
  }
}

async function findLatestFile(bucket, kind, id) {
  const files = await bucket
    .find({ 'metadata.kind': kind, 'metadata.ownerId': id })
    .sort({ uploadDate: -1 })
    .limit(1)
    .toArray()
  return (files && files[0]) || null
}

function baseUrl(req) {
  const proto =
    req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || (req.secure ? 'https' : 'http')
  return `${proto}://${req.get('host')}`
}

/**
 * GET JSON -> { signatureUrl }
 * - employees: /api/admin/signatures/employees/:id/view
 * - users:     /api/admin/signatures/users/:id/view
 */
exports.getEmployeeSignature = async (req, res) => {
  try {
    if (!isSignatureViewer(req)) return res.status(403).json({ message: 'Forbidden' })

    const employeeId = s(req.params.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    const bucket = getBucket()
    const latest = await findLatestFile(bucket, 'employees', employeeId)
    if (!latest) return res.status(404).json({ signatureUrl: '' })

    return res.json({
      signatureUrl: `${baseUrl(req)}/api/admin/signatures/employees/${encodeURIComponent(
        employeeId
      )}/view`,
    })
  } catch (e) {
    console.error('getEmployeeSignature error', e)
    return res.status(500).json({ message: 'Failed to load signature.' })
  }
}

exports.getUserSignature = async (req, res) => {
  try {
    if (!isSignatureViewer(req)) return res.status(403).json({ message: 'Forbidden' })

    const loginId = s(req.params.loginId)
    if (!loginId) return res.status(400).json({ message: 'loginId is required' })

    const bucket = getBucket()
    const latest = await findLatestFile(bucket, 'users', loginId)
    if (!latest) return res.status(404).json({ signatureUrl: '' })

    return res.json({
      signatureUrl: `${baseUrl(req)}/api/admin/signatures/users/${encodeURIComponent(loginId)}/view`,
    })
  } catch (e) {
    console.error('getUserSignature error', e)
    return res.status(500).json({ message: 'Failed to load signature.' })
  }
}

/**
 * STREAM image (protected)
 * GET /api/admin/signatures/employees/:id/view
 * GET /api/admin/signatures/users/:id/view
 */
exports.viewSignature = async (req, res) => {
  try {
    if (!isSignatureViewer(req)) return res.status(403).json({ message: 'Forbidden' })

    const kind = s(req.params.kind) // employees | users
    const id = s(req.params.id)
    if (!id) return res.status(400).json({ message: 'id is required' })
    if (kind !== 'employees' && kind !== 'users') {
      return res.status(400).json({ message: 'Invalid kind' })
    }

    const bucket = getBucket()
    const latest = await findLatestFile(bucket, kind, id)
    if (!latest) return res.status(404).json({ message: 'Signature not found' })

    res.setHeader('Content-Type', latest.contentType || 'application/octet-stream')
    res.setHeader('Cache-Control', 'private, max-age=60') // short cache
    res.setHeader('Content-Disposition', 'inline')

    const stream = bucket.openDownloadStream(latest._id)
    stream.on('error', () => res.status(500).end())
    return stream.pipe(res)
  } catch (e) {
    console.error('viewSignature error', e)
    return res.status(500).json({ message: 'Failed to view signature.' })
  }
}

/**
 * Upload signature (protected)
 * POST /api/admin/signatures/:kind/:id
 * - kind: employees | users
 * - id: employeeId or loginId
 */
exports.uploadSignature = async (req, res) => {
  try {
    // only admins can upload signatures
    const roles = getRoles(req)
    const canUpload =
      roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
    if (!canUpload) return res.status(403).json({ message: 'Forbidden' })

    const kind = s(req.params.kind)
    const id = s(req.params.id)
    if (!id) return res.status(400).json({ message: 'id is required' })
    if (kind !== 'employees' && kind !== 'users') return res.status(400).json({ message: 'Invalid kind' })

    const file = pickUploadedFile(req)
    if (!file) return res.status(400).json({ message: 'No file uploaded' })

    // multer.memoryStorage -> file.buffer exists
    if (!file.buffer || !file.size) return res.status(400).json({ message: 'Invalid upload payload' })
    if (file.size > 2 * 1024 * 1024) return res.status(400).json({ message: 'File too large (max 2MB)' })

    const mime = s(file.mimetype)
    if (!EXT_OK.has(mime)) {
      return res.status(400).json({ message: 'Only PNG/JPG/WEBP allowed' })
    }

    const bucket = getBucket()

    // Replace any previous signature for this owner
    await deleteExisting(bucket, kind, id)

    // store with stable filename (not a public path; it’s protected anyway)
    const filename = `${kind}_${id}_${Date.now()}`

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: mime,
      metadata: {
        kind,
        ownerId: id,
        originalName: s(file.originalname || ''),
        uploadedAt: new Date(),
        uploadedBy: s(req.user?.loginId || req.user?.id || ''),
      },
    })

    const readable = Readable.from(file.buffer)
    readable.pipe(uploadStream)

    uploadStream.on('error', (err) => {
      console.error('GridFS upload error', err)
      return res.status(500).json({ message: 'Upload failed' })
    })

    uploadStream.on('finish', () => {
      return res.json({
        ok: true,
        kind,
        id,
        signatureUrl: `${baseUrl(req)}/api/admin/signatures/${kind}/${encodeURIComponent(id)}/view`,
      })
    })
  } catch (e) {
    console.error('uploadSignature error', e)
    return res.status(500).json({ message: 'Failed to upload signature.' })
  }
}
