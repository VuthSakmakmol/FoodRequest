/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.attachments.controller.js

const createError = require('http-errors')
const crypto = require('crypto')

const LeaveRequest = require('../../models/leave/LeaveRequest')
const { uploadBuffer, deleteFile, toObjectId, getBucket } = require('../../utils/gridfs')

const BUCKET = 'leave_evidence'

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => up(x)).filter(Boolean))]
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function isAdmin(req) {
  const roles = getRoles(req)
  return roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
}

/**
 * ✅ READ rule:
 * - requester can read
 * - admin can read
 * - assigned approvers (manager/gm/coo) can read
 */
function canReadRequest(req, requestDoc) {
  if (!requestDoc) return false
  const me = actorLoginId(req)
  if (!me) return false
  if (isAdmin(req)) return true
  if (s(requestDoc.requesterLoginId) === me) return true

  // ✅ allow assigned approvers to preview evidence
  if (s(requestDoc.managerLoginId) === me) return true
  if (s(requestDoc.gmLoginId) === me) return true
  if (s(requestDoc.cooLoginId) === me) return true

  return false
}

/**
 * ✅ WRITE rule (CRUD):
 * - ONLY requester (user) can upload/delete
 * - admin and approvers are READ-ONLY
 */
function canWriteRequest(req, requestDoc) {
  if (!requestDoc) return false
  const me = actorLoginId(req)
  if (!me) return false
  return s(requestDoc.requesterLoginId) === me
}

function buildContentUrl(reqId, attId, ts) {
  const q = ts ? `?ts=${ts}` : ''
  return `/leave/requests/${encodeURIComponent(reqId)}/attachments/${encodeURIComponent(attId)}/content${q}`
}

function newAttId() {
  return crypto.randomBytes(10).toString('hex')
}

/* ───────────────── LIST ─────────────────
GET /api/leave/requests/:id/attachments
*/
exports.list = async (req, res, next) => {
  try {
    const id = s(req.params.id)
    const doc = await LeaveRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Request not found')
    if (!canReadRequest(req, doc)) throw createError(403, 'Forbidden')

    const rows = Array.isArray(doc.attachments) ? doc.attachments : []
    const items = rows.map((a) => {
      const ts = a?.uploadedAt ? new Date(a.uploadedAt).getTime() : Date.now()
      return {
        attId: a.attId,
        filename: a.filename || '',
        contentType: a.contentType || '',
        size: Number(a.size || 0),
        uploadedAt: a.uploadedAt || null,
        uploadedBy: a.uploadedBy || '',
        note: a.note || '',
        url: buildContentUrl(id, a.attId, ts),
      }
    })

    return res.json({ items })
  } catch (e) {
    next(e)
  }
}

/* ───────────────── UPLOAD MANY (requester only) ─────────────────
POST /api/leave/requests/:id/attachments
*/
exports.uploadMany = async (req, res, next) => {
  try {
    const id = s(req.params.id)
    const doc = await LeaveRequest.findById(id)
    if (!doc) throw createError(404, 'Request not found')
    if (!canWriteRequest(req, doc)) throw createError(403, 'Only requester can upload attachments.')

    const files = Array.isArray(req.files) ? req.files : []
    if (!files.length) throw createError(400, 'No files uploaded (field must be "files")')

    const existing = Array.isArray(doc.attachments) ? doc.attachments : []
    if (existing.length >= 20) throw createError(400, 'Attachment limit reached (max 20 per request)')

    const uploader = actorLoginId(req)

    const added = []
    for (const f of files) {
      const mime = String(f?.mimetype || '').toLowerCase()
      if (!ALLOWED.has(mime)) throw createError(400, `File type not allowed: ${mime || 'unknown'}`)

      const buffer = f?.buffer
      if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) throw createError(400, 'File buffer missing')

      const attId = newAttId()
      const filename = s(f.originalname || `evidence_${attId}`)
      const safeName = filename.replace(/[^\w.\-() ]+/g, '_')

      const gridFile = await uploadBuffer({
        buffer,
        filename: `leave_${id}_${attId}_${safeName}`,
        contentType: mime,
        bucketName: BUCKET,
        metadata: { module: 'leave', requestId: id, attId, uploadedBy: uploader },
      })

      const fileId = gridFile?._id
      if (!fileId) throw createError(500, 'Upload failed')

      const one = {
        attId,
        fileId,
        filename,
        contentType: gridFile?.contentType || mime,
        size: Number(gridFile?.length || buffer.length || 0),
        uploadedAt: gridFile?.uploadDate || new Date(),
        uploadedBy: uploader,
        note: '',
      }

      doc.attachments.push(one)
      added.push(one)
    }

    if (doc.attachments.length > 20) throw createError(400, 'Attachment limit reached (max 20 per request)')
    await doc.save()

    const items = added.map((a) => {
      const ts = a?.uploadedAt ? new Date(a.uploadedAt).getTime() : Date.now()
      return {
        attId: a.attId,
        filename: a.filename || '',
        contentType: a.contentType || '',
        size: Number(a.size || 0),
        uploadedAt: a.uploadedAt || null,
        uploadedBy: a.uploadedBy || '',
        note: a.note || '',
        url: buildContentUrl(id, a.attId, ts),
      }
    })

    return res.json({ ok: true, added: items })
  } catch (e) {
    next(e)
  }
}

/* ───────────────── STREAM (readers allowed) ─────────────────
GET /api/leave/requests/:id/attachments/:attId/content
*/
exports.stream = async (req, res, next) => {
  try {
    const id = s(req.params.id)
    const attId = s(req.params.attId)

    const doc = await LeaveRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Request not found')
    if (!canReadRequest(req, doc)) throw createError(403, 'Forbidden')

    const a = (doc.attachments || []).find((x) => s(x.attId) === attId)
    if (!a?.fileId) throw createError(404, 'Attachment not found')

    const oid = toObjectId(a.fileId)
    if (!oid) throw createError(404, 'Attachment not found')

    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (a.contentType) res.setHeader('Content-Type', a.contentType)

    const b = getBucket(BUCKET)
    const stream = b.openDownloadStream(oid)

    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end()
      else res.end()
    })

    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

/* ───────────────── DELETE (requester only) ─────────────────
DELETE /api/leave/requests/:id/attachments/:attId
*/
exports.remove = async (req, res, next) => {
  try {
    const id = s(req.params.id)
    const attId = s(req.params.attId)

    const doc = await LeaveRequest.findById(id)
    if (!doc) throw createError(404, 'Request not found')
    if (!canWriteRequest(req, doc)) throw createError(403, 'Only requester can delete attachments.')

    const arr = Array.isArray(doc.attachments) ? doc.attachments : []
    const idx = arr.findIndex((x) => s(x.attId) === attId)
    if (idx < 0) throw createError(404, 'Attachment not found')

    const fileId = arr[idx]?.fileId
    doc.attachments.splice(idx, 1)
    await doc.save()

    try {
      await deleteFile(fileId, BUCKET)
    } catch {}

    return res.json({ ok: true, deleted: true, attId })
  } catch (e) {
    next(e)
  }
}