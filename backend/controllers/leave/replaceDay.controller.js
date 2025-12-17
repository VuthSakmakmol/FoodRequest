/* eslint-disable no-console */
//backend/controllers/leave/replaceDay.controller.js
const ReplaceDayRequest   = require('../../models/leave/ReplaceDayRequest')
const LeaveProfile        = require('../../models/leave/LeaveProfile')
const EmployeeDirectory   = require('../../models/EmployeeDirectory')
const { isHoliday }       = require('../../utils/holidays')

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}

function safeNum(n) {
  const v = Number(n || 0)
  return Number.isFinite(v) ? v : 0
}

function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map(r => String(r || '').toUpperCase()))]
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
}

async function attachEmployeeInfoToOne(doc) {
  if (!doc) return doc
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const employeeId = String(raw.employeeId || '').trim()
  if (!employeeId) return raw

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  return {
    ...raw,
    employeeName: emp?.name || emp?.fullName || raw.employeeName || '',
    department: emp?.departmentName || emp?.department || raw.department || '',
  }
}

async function attachEmployeeInfo(docs = []) {
  const ids = [...new Set((docs || []).map(d => String(d.employeeId || '').trim()).filter(Boolean))]
  if (!ids.length) return docs

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  const map = new Map(emps.map(e => [String(e.employeeId || '').trim(), e]))

  return (docs || []).map(d => {
    const emp = map.get(String(d.employeeId || '').trim())
    return {
      ...d,
      employeeName: emp?.name || emp?.fullName || d.employeeName || '',
      department: emp?.departmentName || emp?.department || d.department || '',
    }
  })
}

function stripEvidenceBuffers(doc) {
  return {
    ...doc,
    evidences: Array.isArray(doc.evidences)
      ? doc.evidences.map(e => ({
          _id: e._id,
          filename: e.filename,
          mimetype: e.mimetype,
          size: e.size,
          uploadedAt: e.uploadedAt,
        }))
      : [],
  }
}

/**
 * POST /api/leave/replace-days
 * multipart/form-data:
 * - requestDate (YYYY-MM-DD)          ✅ can be ANY day (working day / sunday / holiday)
 * - compensatoryDate (YYYY-MM-DD)     ✅ must be working day (Mon–Sat) and NOT a holiday
 * - reason (string)
 * - evidence (files[])               ✅ stored in MongoDB (Buffer)
 */
exports.createMyReplaceDay = async (req, res, next) => {
  try {
    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()

    const requestDate       = String(req.body?.requestDate || '').trim()
    const compensatoryDate  = String(req.body?.compensatoryDate || '').trim()
    const reason            = String(req.body?.reason || '').trim()

    if (!requesterLoginId || !employeeId) {
      return res.status(400).json({ message: 'Missing requester identity' })
    }

    if (!requestDate || !compensatoryDate) {
      return res.status(400).json({ message: 'requestDate and compensatoryDate are required' })
    }

    if (!isValidYMD(requestDate) || !isValidYMD(compensatoryDate)) {
      return res.status(400).json({ message: 'Dates must be in YYYY-MM-DD format' })
    }

    // ✅ NEW RULE:
    // requestDate (day you worked) can be ANY date -> no restriction here.

    // ✅ Rule: compensatory day off must be a WORKING day (Mon–Sat) and NOT a holiday/Sunday.
    if (isHoliday(compensatoryDate)) {
      return res.status(400).json({
        message: 'Compensatory Day Off cannot be on Sunday or Cambodian National Holiday. Please change date.',
      })
    }

    // Lookup LeaveProfile to route approvals
    const profile = await LeaveProfile.findOne({ employeeId, isActive: true }).lean()
    if (!profile) {
      return res.status(400).json({
        message: 'Leave profile is not configured for this employee. Please contact HR/admin.',
      })
    }

    const managerLoginId = String(profile.managerLoginId || '').trim()
    const gmLoginId      = String(profile.gmLoginId || '').trim()
    if (!managerLoginId || !gmLoginId) {
      return res.status(400).json({
        message: 'Manager/GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    // ✅ Evidence files (multiple) stored in MongoDB
    const files = Array.isArray(req.files) ? req.files : []
    const evidences = files.map(f => ({
      filename: String(f.originalname || 'evidence'),
      mimetype: String(f.mimetype || ''),
      size: safeNum(f.size),
      data: f.buffer, // ✅ Buffer in MongoDB
      uploadedAt: new Date(),
    }))

    const doc = await ReplaceDayRequest.create({
      employeeId,
      requesterLoginId,
      requestDate,
      compensatoryDate,
      reason,
      evidences,
      status: 'PENDING_MANAGER',
      managerLoginId,
      gmLoginId,
    })

    const enriched = await attachEmployeeInfoToOne(doc)
    return res.status(201).json(stripEvidenceBuffers(enriched))
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/replace-days/my
 */
exports.listMyReplaceDays = async (req, res, next) => {
  try {
    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()

    if (!employeeId) return res.status(400).json({ message: 'Missing user identity' })

    const docs = await ReplaceDayRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    const enriched = await attachEmployeeInfo(docs)
    res.json(enriched.map(stripEvidenceBuffers))
  } catch (err) {
    next(err)
  }
}

/**
 * PATCH /api/leave/replace-days/:id/cancel
 */
exports.cancelMyReplaceDay = async (req, res, next) => {
  try {
    const loginId     = String(req.user?.id || '').trim()
    const employeeId  = String(req.user?.employeeId || loginId).trim()
    const { id }      = req.params

    const doc = await ReplaceDayRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (String(doc.employeeId || '') !== employeeId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (!['PENDING_MANAGER', 'PENDING_GM'].includes(String(doc.status || ''))) {
      return res.status(400).json({ message: 'Cannot cancel at this stage' })
    }

    doc.status = 'CANCELLED'
    doc.cancelledAt = new Date()
    doc.cancelledById = loginId
    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    res.json(stripEvidenceBuffers(payload))
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/replace-days/manager/inbox
 * - manager sees their own
 * - admin can see all
 */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const criteria = isAdminViewer(req) ? {} : { managerLoginId: loginId }

    const docs = await ReplaceDayRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    const enriched = await attachEmployeeInfo(docs)
    res.json(enriched.map(stripEvidenceBuffers))
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/leave/replace-days/:id/manager-decision
 */
exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await ReplaceDayRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    // manager can act only on own items; admin can act on all
    if (!isAdminViewer(req) && String(doc.managerLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (String(doc.status || '') !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    if (action === 'APPROVE') doc.status = 'PENDING_GM'
    else if (action === 'REJECT') doc.status = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    doc.managerComment = String(comment || '')
    doc.managerDecisionAt = new Date()
    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    res.json(stripEvidenceBuffers(payload))
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/replace-days/gm/inbox
 * - GM sees their own
 * - admin can see all
 */
exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const criteria = isAdminViewer(req) ? {} : { gmLoginId: loginId }

    const docs = await ReplaceDayRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    const enriched = await attachEmployeeInfo(docs)
    res.json(enriched.map(stripEvidenceBuffers))
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/leave/replace-days/:id/gm-decision
 */
exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await ReplaceDayRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    // gm can act only on own items; admin can act on all
    if (!isAdminViewer(req) && String(doc.gmLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (String(doc.status || '') !== 'PENDING_GM') {
      return res.status(400).json({ message: 'Request not in GM queue' })
    }

    if (action === 'APPROVE') doc.status = 'APPROVED'
    else if (action === 'REJECT') doc.status = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    doc.gmComment = String(comment || '')
    doc.gmDecisionAt = new Date()
    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    res.json(stripEvidenceBuffers(payload))
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/replace-days/:id/evidences/:evidenceId
 * Stream evidence file (Buffer stored in MongoDB)
 */
exports.downloadEvidence = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const employeeId = String(req.user?.employeeId || loginId).trim()

    const { id, evidenceId } = req.params

    const doc = await ReplaceDayRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    // Permission:
    // - owner can download
    // - manager of this request can download
    // - gm of this request can download
    // - admin can download
    const isOwner = String(doc.employeeId || '') === employeeId
    const roles = getRoles(req)
    const isAdmin = roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
    const isManager = String(doc.managerLoginId || '') === loginId
    const isGm = String(doc.gmLoginId || '') === loginId

    if (!isOwner && !isAdmin && !isManager && !isGm) {
      return res.status(403).json({ message: 'No permission' })
    }

    const ev = (doc.evidences || []).find(e => String(e._id) === String(evidenceId))
    if (!ev) return res.status(404).json({ message: 'Evidence not found' })

    // stream buffer
    res.setHeader('Content-Type', ev.mimetype || 'application/octet-stream')
    // use "inline" so PDFs/images open in browser; user can still download
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(ev.filename || 'evidence')}"`,
    )
    res.setHeader('Content-Length', Number(ev.size || (ev.data?.length || 0)))

    return res.send(ev.data)
  } catch (err) {
    next(err)
  }
}

