/* eslint-disable no-console */
// backend/controllers/leave/swapWorkingDay.evidence.controller.js

const createError = require('http-errors')
const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const { getBucket, uploadBuffer, deleteFile, toObjectId } = require('../../utils/gridfs')

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.id || req.user?.sub || '')
}

function uniqAttachments(arr) {
  const seen = new Set()
  return (arr || []).filter((a) => {
    const key = s(a?.fileId)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ─────────────────────────────────────────────
   UPLOAD EVIDENCE
   POST /swap-working-day/:id/evidence
───────────────────────────────────────────── */
exports.uploadEvidence = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    // owner only
    if (s(doc.requesterLoginId) !== loginId) {
      throw createError(403, 'Not your request')
    }

    if (!req.file) {
      throw createError(400, 'No file uploaded')
    }

    const { originalname, mimetype, buffer, size } = req.file

    // 5MB limit safety (multer already limits, but double-check)
    if (size > 5 * 1024 * 1024) {
      throw createError(400, 'File exceeds 5MB limit')
    }

    const attId = crypto.randomUUID?.() || `att_${Date.now()}`
    const bucket = getBucket('swapEvidence')

    const file = await uploadBuffer(bucket, buffer, originalname, {
      contentType: mimetype,
      metadata: {
        swapRequestId: id,
        uploadedBy: loginId,
      },
    })

    const attachment = {
      attId,
      fileId: file._id,
      filename: originalname,
      contentType: mimetype,
      size,
      uploadedAt: new Date(),
      uploadedBy: loginId,
    }

    doc.attachments = uniqAttachments([...(doc.attachments || []), attachment])
    await doc.save()

    return res.status(201).json({
      attId,
      fileId: file._id,
      filename: originalname,
      contentType: mimetype,
      size,
    })
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   GET EVIDENCE CONTENT
   GET /swap-working-day/:id/evidence/:fileId
───────────────────────────────────────────── */
exports.getEvidenceContent = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id, fileId } = req.params

    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    const allowed =
      s(doc.requesterLoginId) === loginId ||
      s(doc.managerLoginId) === loginId ||
      s(doc.gmLoginId) === loginId ||
      s(doc.cooLoginId) === loginId

    if (!allowed) throw createError(403, 'Forbidden')

    const bucket = getBucket('swapEvidence')
    const _id = toObjectId(fileId)

    res.setHeader('Content-Disposition', 'inline')

    const stream = bucket.openDownloadStream(_id)
    stream.on('error', () => {
      res.status(404).end()
    })

    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   DELETE EVIDENCE
   DELETE /swap-working-day/:id/evidence/:fileId
───────────────────────────────────────────── */
exports.deleteEvidence = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id, fileId } = req.params

    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    if (s(doc.requesterLoginId) !== loginId) {
      throw createError(403, 'Not your request')
    }

    const bucket = getBucket('swapEvidence')
    await deleteFile(bucket, fileId)

    doc.attachments = (doc.attachments || []).filter(
      (a) => s(a.fileId) !== s(fileId)
    )

    await doc.save()

    return res.json({ success: true })
  } catch (e) {
    next(e)
  }
}