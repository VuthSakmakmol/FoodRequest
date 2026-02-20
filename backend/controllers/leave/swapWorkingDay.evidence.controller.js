/* eslint-disable no-console */
// backend/controllers/leave/swapWorkingDay.evidence.controller.js

const createError = require('http-errors')
const crypto = require('crypto')

const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const { getBucket, uploadBuffer, toObjectId } = require('../../utils/gridfs')
const { broadcastSwapRequest } = require('../../utils/swap.realtime')

const SWAP_BUCKET = 'swap_evidence'

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || req.user?.empId || '')
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

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitSwap(req, doc, event = 'swap:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastSwapRequest(io, doc, event)
  } catch (e) {
    console.warn('⚠️ swap realtime emit failed:', e?.message)
  }
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

/* ✅ lock attachment changes once ANY approval approved */
function hasAnyApproved(approvals) {
  const arr = Array.isArray(approvals) ? approvals : []
  return arr.some((a) => up(a?.status) === 'APPROVED')
}

function ensurePendingForEdit(doc) {
  const st = up(doc.status)
  if (!st.startsWith('PENDING')) {
    throw createError(400, `Attachments can only be modified while request is pending. Current status: ${doc.status}`)
  }
  if (hasAnyApproved(doc?.approvals)) {
    throw createError(400, 'This request already has an approval. Attachments can no longer be changed.')
  }
}

function safeFilename(name) {
  const raw = String(name || 'file')
  const cleaned = raw.replace(/[\r\n"]/g, ' ').replace(/[^\w.\-() ]+/g, '_').trim()
  return (cleaned || 'file').slice(0, 120)
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
   multipart: files (array)
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

    const added = []
    const existing = Array.isArray(doc.attachments) ? doc.attachments : []

    for (const f of files) {
      const originalname = s(f.originalname)
      const mimetype = s(f.mimetype).toLowerCase()
      const size = Number(f.size || 0) || 0
      const buffer = f.buffer

      const ok = mimetype.includes('pdf') || mimetype.startsWith('image/')
      if (!ok) throw createError(400, `File "${originalname}" is not allowed (PDF/images only).`)
      if (size > 5 * 1024 * 1024) throw createError(400, `File "${originalname}" exceeds 5MB limit.`)
      if (!buffer) throw createError(400, `File "${originalname}" missing buffer.`)

      const uploaded = await uploadBuffer({
        buffer,
        filename: originalname,
        contentType: mimetype,
        metadata: { swapRequestId: id, uploadedBy: loginId },
        bucketName: SWAP_BUCKET,
      })

      const oid = toObjectId(uploaded?._id)
      if (!oid) throw createError(500, 'Upload failed: invalid GridFS file id')

      // ✅ optional dedupe by fileId (in case of re-upload same doc)
      const already = existing.some((a) => String(a.fileId) === String(oid)) || added.some((a) => String(a.fileId) === String(oid))
      if (already) continue

      added.push({
        attId: crypto.randomUUID?.() || `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        fileId: oid, // ✅ always ObjectId
        filename: originalname,
        contentType: mimetype,
        size,
        uploadedAt: new Date(),
        uploadedBy: loginId,
      })
    }

    if (!added.length) {
      return res.status(200).json({ success: true, files: [] })
    }

    doc.attachments = [...existing, ...added]
    await doc.save()

    emitSwap(req, doc.toObject ? doc.toObject() : doc, 'swap:req:updated')

    return res.status(201).json({ success: true, files: added.map(safeAttPayload) })
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

    const filename = safeFilename(att.filename || file.filename || 'file')
    res.setHeader('Content-Type', file.contentType || att.contentType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)

    const stream = bucket.openDownloadStream(_id)

    stream.on('error', () => {
      if (!res.headersSent) return next(createError(404, 'File not found'))
      try {
        res.end()
      } catch {}
    })

    req.on('aborted', () => {
      try {
        stream.destroy()
      } catch {}
    })

    stream.pipe(res)
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

    emitSwap(req, doc.toObject ? doc.toObject() : doc, 'swap:req:updated')

    return res.json({ success: true })
  } catch (e) {
    next(e)
  }
}