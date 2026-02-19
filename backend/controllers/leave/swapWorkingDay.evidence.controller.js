/* eslint-disable no-console */
// backend/controllers/leave/swapWorkingDay.evidence.controller.js

const createError = require('http-errors')
const crypto = require('crypto')

const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const { getBucket, uploadBuffer, toObjectId } = require('../../utils/gridfs')

const SWAP_BUCKET = 'swap_evidence'

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map((x) => up(x)).filter(Boolean))]
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
}

function canViewDoc(req, doc) {
  const me = actorLoginId(req)
  if (!me) return false
  return (
    isAdminViewer(req) ||
    s(doc.requesterLoginId) === me ||
    s(doc.managerLoginId) === me ||
    s(doc.gmLoginId) === me ||
    s(doc.cooLoginId) === me
  )
}

function ensureOwner(req, doc) {
  const me = actorLoginId(req)
  if (!me) throw createError(400, 'Missing user identity')
  if (s(doc.requesterLoginId) !== me) throw createError(403, 'Not your request')
}

function ensurePendingForEdit(doc) {
  const st = up(doc.status)
  if (!st.startsWith('PENDING')) {
    throw createError(400, `Attachments can only be modified while request is pending. Current status: ${doc.status}`)
  }
}

function safeAttPayload(a) {
  return {
    attId: s(a.attId),
    fileId: String(a.fileId),
    filename: s(a.filename),
    contentType: s(a.contentType),
    size: Number(a.size || 0) || 0,
    uploadedAt: a.uploadedAt,
    uploadedBy: s(a.uploadedBy),
    note: s(a.note || ''),
  }
}

/* ─────────────────────────────────────────────
   LIST ATTACHMENTS (metadata)
   GET /api/leave/swap-working-day/:id/evidence
───────────────────────────────────────────── */
exports.listEvidence = async (req, res, next) => {
  try {
    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Swap request not found')

    if (!canViewDoc(req, doc)) throw createError(403, 'Forbidden')

    const list = Array.isArray(doc.attachments) ? doc.attachments : []
    return res.json(list.map(safeAttPayload))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   UPLOAD EVIDENCE (MULTI)
   POST /api/leave/swap-working-day/:id/evidence
   multipart: files[]
───────────────────────────────────────────── */
exports.uploadEvidence = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    ensureOwner(req, doc)
    ensurePendingForEdit(doc)

    const files = Array.isArray(req.files) ? req.files : []
    if (!files.length) throw createError(400, 'No files uploaded')

    const attachments = []

    for (const f of files) {
      const originalname = s(f.originalname)
      const mimetype = s(f.mimetype).toLowerCase()
      const size = Number(f.size || 0) || 0
      const buffer = f.buffer

      // allow only pdf/images
      const ok = mimetype.includes('pdf') || mimetype.startsWith('image/')
      if (!ok) throw createError(400, `File "${originalname}" is not allowed (PDF/images only).`)

      // safety limit (multer already does)
      if (size > 5 * 1024 * 1024) throw createError(400, `File "${originalname}" exceeds 5MB limit.`)

      const uploaded = await uploadBuffer({
        buffer,
        filename: originalname,
        contentType: mimetype,
        metadata: {
          swapRequestId: id,
          uploadedBy: loginId,
        },
        bucketName: SWAP_BUCKET,
      })

      attachments.push({
        attId: crypto.randomUUID?.() || `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        fileId: uploaded._id,
        filename: originalname,
        contentType: mimetype,
        size,
        uploadedAt: new Date(),
        uploadedBy: loginId,
      })
    }

    doc.attachments = [...(doc.attachments || []), ...attachments]
    await doc.save()

    return res.status(201).json({ success: true, files: attachments.map(safeAttPayload) })
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   PREVIEW (STREAM) BY attId (SECURE)
   GET /api/leave/swap-working-day/:id/evidence/:attId/content
───────────────────────────────────────────── */
exports.getEvidenceContent = async (req, res, next) => {
  try {
    const { id, attId } = req.params

    const doc = await SwapWorkingDayRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Swap request not found')

    if (!canViewDoc(req, doc)) throw createError(403, 'Forbidden')

    const att = (doc.attachments || []).find((a) => s(a.attId) === s(attId))
    if (!att) throw createError(404, 'Attachment not found')

    const _id = toObjectId(att.fileId)
    if (!_id) throw createError(400, 'Invalid file id')

    const bucket = getBucket(SWAP_BUCKET)
    const file = await bucket.find({ _id }).next()
    if (!file) throw createError(404, 'File not found')

    res.setHeader('Content-Type', file.contentType || att.contentType || 'application/octet-stream')
    res.setHeader('Content-Disposition', 'inline')

    bucket.openDownloadStream(_id).pipe(res)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   DELETE BY attId (SECURE)
   DELETE /api/leave/swap-working-day/:id/evidence/:attId
───────────────────────────────────────────── */
exports.deleteEvidence = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id, attId } = req.params

    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    ensureOwner(req, doc)
    ensurePendingForEdit(doc)

    const idx = (doc.attachments || []).findIndex((a) => s(a.attId) === s(attId))
    if (idx < 0) throw createError(404, 'Attachment not found')

    const att = doc.attachments[idx]
    const fileObjectId = toObjectId(att.fileId)
    if (!fileObjectId) throw createError(400, 'Invalid file id')

    const bucket = getBucket(SWAP_BUCKET)
    await bucket.delete(fileObjectId)

    doc.attachments.splice(idx, 1)
    await doc.save()

    return res.json({ success: true })
  } catch (e) {
    next(e)
  }
}