// backend/controllers/leave/leaveRequest.controller.js
/* eslint-disable no-console */

const LeaveRequest  = require('../../models/leave/LeaveRequest')
const LeaveType     = require('../../models/leave/LeaveType')
const LeaveProfile  = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { enumerateLocalDates } = require('../../utils/datetime')
const {
  notifyNewLeaveToManager,
  notifyManagerDecision,
  notifyNewLeaveToGm,
  notifyGmDecision,
} = require('../../services/leave/leave.telegram.notify')
const { broadcastLeaveRequest } = require('../../utils/realtime')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const DEBUG =
  String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

/* ────────────────────────────────────────────────
 * Helper: apply approved leave usage into profile
 * ────────────────────────────────────────────────
 */
async function applyApprovedLeaveToProfile(reqDoc) {
  const days = Number(reqDoc.totalDays || 0)
  if (!days) return

  const employeeId    = String(reqDoc.employeeId || '').trim()
  const leaveTypeCode = String(reqDoc.leaveTypeCode || '').trim().toUpperCase()

  if (!employeeId || !leaveTypeCode) return

  // find leave type + profile
  const type = await LeaveType.findOne({ code: leaveTypeCode }).lean()
  if (!type) return

  const profile = await LeaveProfile.findOne({ employeeId })
  if (!profile) return

  if (!Array.isArray(profile.balances)) {
    profile.balances = []
  }

  // find / create balance row for this type
  let bal = profile.balances.find(
    b => String(b.leaveTypeCode).toUpperCase() === leaveTypeCode
  )

  if (!bal) {
    bal = {
      leaveTypeCode,
      yearlyEntitlement: Number(type.yearlyEntitlement || 0),
      used: 0,
      remaining: Number(type.yearlyEntitlement || 0),
    }
    profile.balances.push(bal)
  }

  // If this type does not require balance (e.g. UL),
  // we just track "used" but don't touch "remaining"
  if (!type.requiresBalance) {
    bal.used = Number(bal.used || 0) + days
  } else {
    const allowNegative = !!type.allowNegative
    const currentRem    = Number(bal.remaining || 0)

    if (!allowNegative && currentRem < days) {
      throw new Error(
        `Insufficient balance for ${leaveTypeCode}. Remaining ${currentRem}, requested ${days}`
      )
    }

    bal.used      = Number(bal.used || 0) + days
    bal.remaining = currentRem - days

    if (!allowNegative && bal.remaining < 0) {
      bal.remaining = 0
    }
  }

  profile.markModified('balances')
  await profile.save()
}

/* Small helper to get io instance safely */
function getIo(req) {
  return req.io || req.app?.get('io') || null
}

/* ────────────────────────────────────────────────
 * Attach employeeName/department from EmployeeDirectory
 * ────────────────────────────────────────────────
 */
async function attachEmployeeInfo(docs = []) {
  const ids = [...new Set(
    (docs || [])
      .map(d => String(d.employeeId || '').trim())
      .filter(Boolean)
  )]

  if (!ids.length) return docs

  // Adjust fields here if your EmployeeDirectory uses different names
  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map(emps.map(e => [String(e.employeeId || '').trim(), e]))

  return (docs || []).map(d => {
    const emp = map.get(String(d.employeeId || '').trim())
    return {
      ...d,
      employeeName: emp?.name || d.employeeName || '',
      department: emp?.department || d.department || '',
    }
  })
}

async function attachEmployeeInfoToOne(doc) {
  if (!doc) return doc
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const employeeId = String(raw.employeeId || '').trim()
  if (!employeeId) return raw

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  return {
    ...raw,
    employeeName: emp?.name || raw.employeeName || '',
    department: emp?.department || raw.department || '',
  }
}

/* ────────────────────────────────────────────────
 * POST /api/leave/requests
 * Body: { leaveTypeCode, startDate, endDate, reason }
 * Creates a new request for the logged-in user (expat).
 * ────────────────────────────────────────────────
 */
exports.createMyRequest = async (req, res, next) => {
  try {
    const { leaveTypeCode, startDate, endDate, reason = '' } = req.body || {}

    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()

    if (!requesterLoginId || !employeeId) {
      return res.status(400).json({ message: 'Missing requester identity' })
    }

    if (!leaveTypeCode || !startDate || !endDate) {
      return res.status(400).json({
        message: 'leaveTypeCode, startDate, and endDate are required',
      })
    }

    // Ensure leave type exists & active
    const lt = await LeaveType.findOne({
      code: String(leaveTypeCode).trim().toUpperCase(),
      isActive: true,
    }).lean()

    if (!lt) {
      return res.status(400).json({ message: 'Invalid or inactive leave type' })
    }

    // Look up LeaveProfile → who is manager / GM for this expat
    const profile = await LeaveProfile.findOne({
      employeeId,
      isActive: true,
    }).lean()

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

    // Calculate days inclusive using helper
    const dates = enumerateLocalDates(startDate, endDate, DEFAULT_TZ)
    const totalDays = dates.length

    if (!totalDays || totalDays <= 0) {
      return res.status(400).json({ message: 'Invalid date range' })
    }

    const doc = await LeaveRequest.create({
      employeeId,
      requesterLoginId,
      leaveTypeCode: lt.code,
      startDate,
      endDate,
      totalDays,
      reason,
      status: 'PENDING_MANAGER',
      managerLoginId,
      gmLoginId,
    })

    if (DEBUG) {
      console.log('[leave] createMyRequest ->', {
        employeeId,
        managerLoginId,
        gmLoginId,
        id: doc._id.toString(),
      })
    }

    // enrich for response + realtime payload
    const payload = await attachEmployeeInfoToOne(doc)

    // 🔔 Telegram DM to manager
    try {
      await notifyNewLeaveToManager(doc)
    } catch (e) {
      console.warn('⚠️ notifyNewLeaveToManager failed:', e?.message)
    }

    // 🌐 Real-time: created/updated
    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:created')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ leave:req:created emit failed:', e?.message)
    }

    res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * GET /api/leave/requests/my
 * Returns leave requests for the logged-in user.
 * ────────────────────────────────────────────────
 */
exports.listMyRequests = async (req, res, next) => {
  try {
    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()

    if (!employeeId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const docs = await LeaveRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    // optional: also include name/department for "My requests" screen
    const enriched = await attachEmployeeInfo(docs)

    res.json(enriched)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * PATCH /api/leave/requests/:id/cancel
 * Only requester can cancel; only while PENDING_MANAGER or PENDING_GM
 * ────────────────────────────────────────────────
 */
exports.cancelMyRequest = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const { id }  = req.params

    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const doc = await LeaveRequest.findById(id)
    if (!doc) {
      return res.status(404).json({ message: 'Request not found' })
    }

    if (String(doc.requesterLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (!['PENDING_MANAGER', 'PENDING_GM'].includes(doc.status)) {
      return res.status(400).json({ message: 'Cannot cancel at this stage' })
    }

    doc.status        = 'CANCELLED'
    doc.cancelledAt   = new Date()
    doc.cancelledById = loginId

    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)

    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ leave:req:cancel emit failed:', e?.message)
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * GET /api/leave/requests/manager/inbox
 * Manager(or admin) inbox
 * ────────────────────────────────────────────────
 */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
    const baseRole = req.user?.role ? [req.user.role] : []
    const roles    = [...new Set([...rawRoles, ...baseRole])]

    const isAdminViewer =
      roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')

    const criteria = isAdminViewer
      ? {}
      : { managerLoginId: loginId }

    const docs = await LeaveRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    const enriched = await attachEmployeeInfo(docs)

    res.json(enriched)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * POST /api/leave/requests/:id/manager-decision
 * Body: { action: 'APPROVE' | 'REJECT', comment? }
 * ────────────────────────────────────────────────
 */
exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (String(doc.managerLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (doc.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    if (action === 'APPROVE') {
      doc.status = 'PENDING_GM'
    } else if (action === 'REJECT') {
      doc.status = 'REJECTED'
    } else {
      return res.status(400).json({ message: 'Invalid action' })
    }

    doc.managerComment    = String(comment || '')
    doc.managerDecisionAt = new Date()

    await doc.save()

    if (DEBUG) {
      console.log('[leave] managerDecision ->', {
        id: doc._id.toString(),
        status: doc.status,
      })
    }

    // 🔔 Telegram: notify employee about manager decision
    try {
      await notifyManagerDecision(doc)
    } catch (e) {
      console.warn('⚠️ notifyManagerDecision failed:', e?.message)
    }

    // 🔔 Telegram: if forwarded to GM, alert GM
    if (doc.status === 'PENDING_GM') {
      try {
        await notifyNewLeaveToGm(doc)
      } catch (e) {
        console.warn('⚠️ notifyNewLeaveToGm failed:', e?.message)
      }
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // 🌐 Real-time: manager decision
    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:manager-decision')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ leave:req:manager-decision emit failed:', e?.message)
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * GET /api/leave/requests/gm/inbox
 * GM(or admin) inbox
 * ────────────────────────────────────────────────
 */
exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
    const baseRole = req.user?.role ? [req.user.role] : []
    const roles    = [...new Set([...rawRoles, ...baseRole])]

    const isAdminViewer =
      roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')

    const criteria = isAdminViewer
      ? {}
      : { gmLoginId: loginId }

    const docs = await LeaveRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    const enriched = await attachEmployeeInfo(docs)

    res.json(enriched)
  } catch (err) {
    next(err)
  }
}

/* ────────────────────────────────────────────────
 * POST /api/leave/requests/:id/gm-decision
 * Body: { action: 'APPROVE' | 'REJECT', comment? }
 * ────────────────────────────────────────────────
 */
exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (String(doc.gmLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (doc.status !== 'PENDING_GM') {
      return res.status(400).json({ message: 'Request not in GM queue' })
    }

    if (action === 'APPROVE') {
      doc.status = 'APPROVED'
    } else if (action === 'REJECT') {
      doc.status = 'REJECTED'
    } else {
      return res.status(400).json({ message: 'Invalid action' })
    }

    doc.gmComment    = String(comment || '')
    doc.gmDecisionAt = new Date()

    await doc.save()

    if (DEBUG) {
      console.log('[leave] gmDecision ->', {
        id: doc._id.toString(),
        status: doc.status,
      })
    }

    // ✅ Only when APPROVED we apply usage into profile
    if (doc.status === 'APPROVED') {
      try {
        await applyApprovedLeaveToProfile(doc)
      } catch (applyErr) {
        console.error('applyApprovedLeaveToProfile error:', applyErr)
      }
    }

    // 🔔 Telegram: final decision to employee
    try {
      await notifyGmDecision(doc)
    } catch (e) {
      console.warn('⚠️ notifyGmDecision failed:', e?.message)
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // 🌐 Real-time: GM decision
    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:gm-decision')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ leave:req:gm-decision emit failed:', e?.message)
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
}
