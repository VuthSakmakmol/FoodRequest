// backend/controllers/files/signature.admin.controller.js
/* eslint-disable no-console */
const fs = require('fs')
const { getBucket, uploadBuffer, deleteFile } = require('../../utils/gridfs')

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp'])

function safeText(v) {
  return String(v ?? '').trim()
}

// ✅ accept multer.single OR multer.fields
function pickUploadedFile(req) {
  if (req.file) return req.file
  const f1 = req.files?.signature?.[0]
  if (f1) return f1
  const f2 = req.files?.file?.[0]
  if (f2) return f2
  return null
}

// ✅ Works for BOTH memoryStorage (buffer) and diskStorage (path)
function getFileBuffer(file) {
  if (file?.buffer && Buffer.isBuffer(file.buffer) && file.buffer.length) return file.buffer
  if (file?.path && fs.existsSync(file.path)) return fs.readFileSync(file.path)
  return null
}

function safeExtFromMime(mime) {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  return '.jpg'
}

function normalizeKind(kind) {
  const k = safeText(kind).toLowerCase()
  if (k === 'employees') return 'employees'
  if (k === 'users') return 'users'
  return ''
}

function normalizeOwnerId(id) {
  return safeText(id)
}

function contentUrl(kind, ownerId, ts) {
  const q = ts ? `?ts=${ts}` : ''
  return `/api/admin/signatures/${encodeURIComponent(kind)}/${encodeURIComponent(ownerId)}/content${q}`
}

async function findLatest(kind, ownerId) {
  const b = getBucket()
  const arr = await b
    .find({ 'metadata.kind': kind, 'metadata.ownerId': ownerId })
    .sort({ uploadDate: -1 })
    .limit(1)
    .toArray()
  return arr?.[0] || null
}

async function deleteAll(kind, ownerId) {
  const b = getBucket()
  const arr = await b.find({ 'metadata.kind': kind, 'metadata.ownerId': ownerId }).toArray()
  for (const f of arr) {
    try {
      await deleteFile(f._id)
    } catch {}
  }
}

/* ───────────────── GET meta (NO 404 spam) ───────────────── */
exports.getEmployeeSignature = async (req, res, next) => {
  try {
    const employeeId = normalizeOwnerId(req.params.employeeId)
    if (!employeeId) return res.json({ exists: false, url: '' })

    const latest = await findLatest('employees', employeeId)
    if (!latest) return res.json({ exists: false, url: '' })

    return res.json({
      exists: true,
      url: contentUrl('employees', employeeId, latest.uploadDate?.getTime?.()),
      contentType: latest.contentType || '',
      size: latest.length || 0,
      uploadedAt: latest.uploadDate || null,
    })
  } catch (e) {
    next(e)
  }
}

exports.getUserSignature = async (req, res, next) => {
  try {
    const loginId = normalizeOwnerId(req.params.loginId)
    if (!loginId) return res.json({ exists: false, url: '' })

    const latest = await findLatest('users', loginId)
    if (!latest) return res.json({ exists: false, url: '' })

    return res.json({
      exists: true,
      url: contentUrl('users', loginId, latest.uploadDate?.getTime?.()),
      contentType: latest.contentType || '',
      size: latest.length || 0,
      uploadedAt: latest.uploadDate || null,
    })
  } catch (e) {
    next(e)
  }
}

/* ───────────────── STREAM content ───────────────── */
exports.streamSignature = async (req, res, next) => {
  try {
    const kind = normalizeKind(req.params.kind)
    const ownerId = normalizeOwnerId(req.params.id)

    if (!kind) return res.status(400).end()
    if (!ownerId) return res.status(404).end()

    const latest = await findLatest(kind, ownerId)
    if (!latest?._id) return res.status(404).end()

    // ✅ Cache safely because URL has ?ts=
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (latest.contentType) res.setHeader('Content-Type', latest.contentType)

    const b = getBucket()
    const stream = b.openDownloadStream(latest._id)

    stream.on('error', () => {
      // avoid double-send if headers already sent
      if (!res.headersSent) res.status(404).end()
      else res.end()
    })

    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

/* ───────────────── UPLOAD ───────────────── */
exports.uploadSignature = async (req, res, next) => {
  try {
    const kind = normalizeKind(req.params.kind)
    const ownerId = normalizeOwnerId(req.params.id)

    if (!kind) return res.status(400).json({ message: 'Invalid kind. Use employees or users.' })
    if (!ownerId) return res.status(400).json({ message: 'Missing id' })

    const file = pickUploadedFile(req)
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded (field must be "signature" or "file")' })
    }

    const mime = String(file.mimetype || '').toLowerCase()
    if (!ALLOWED.has(mime)) return res.status(400).json({ message: 'Only PNG/JPG/WEBP allowed.' })

    const buffer = getFileBuffer(file)
    if (!buffer) {
      return res.status(400).json({ message: 'File buffer missing. Ensure multer memoryStorage is used.' })
    }

    // remove previous signatures for this person (clean)
    await deleteAll(kind, ownerId)

    const safeOwner = ownerId.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = `${kind}_${safeOwner}${safeExtFromMime(mime)}`

    const uploadedBy = safeText(req.user?.loginId || req.user?.username || '')

    const gridFile = await uploadBuffer({
      buffer,
      filename,
      contentType: mime,
      metadata: { kind, ownerId, uploadedBy },
    })

    const ts = gridFile?.uploadDate ? gridFile.uploadDate.getTime() : Date.now()

    return res.json({
      ok: true,
      exists: true,
      kind,
      id: ownerId,
      url: contentUrl(kind, ownerId, ts),
      contentType: gridFile?.contentType || mime,
      size: gridFile?.length || buffer.length || 0,
      uploadedAt: gridFile?.uploadDate || new Date(),
    })
  } catch (e) {
    console.error('[sig] upload error:', e)
    next(e)
  }
}

/* ───────────────── DELETE (optional) ───────────────── */
exports.deleteSignature = async (req, res, next) => {
  try {
    const kind = normalizeKind(req.params.kind)
    const ownerId = normalizeOwnerId(req.params.id)

    if (!kind) return res.status(400).json({ message: 'Invalid kind. Use employees or users.' })
    if (!ownerId) return res.status(400).json({ message: 'Missing id' })

    await deleteAll(kind, ownerId)
    return res.json({ ok: true, deleted: true })
  } catch (e) {
    next(e)
  }
}
