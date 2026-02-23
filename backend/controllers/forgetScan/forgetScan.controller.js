/* eslint-disable no-console */
// backend/controllers/forgetScan/forgetScan.controller.js
//
// ✅ ExpatForgetScan (simple)
// ✅ Approval modes SAME as LeaveProfile:
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Viewers: LEAVE_ADMIN/ADMIN/ROOT_ADMIN can VIEW inbox (pending + ALL via scope)
// ❌ But they CANNOT approve/reject on behalf of manager/gm/coo
//
// ✅ Roles who can DECIDE (NO admin bypass):
//    - managerDecision: LEAVE_MANAGER only
//    - gmDecision     : LEAVE_GM only
//    - cooDecision    : LEAVE_COO only
//
// ✅ Status values:
//    PENDING_MANAGER, PENDING_GM, PENDING_COO, APPROVED, REJECTED, CANCELLED
//
// ✅ Duplicate protection is enforced by Mongo partial unique index in model

const createError = require('http-errors')

const ExpatForgetScanRequest = require('../../models/forgetScan/ExpatForgetScanRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

/* ───────────────── helpers ───────────────── */

/* Notify (Telegram) */
let notify = null
try {
  notify = require('../../services/telegram/forgetScan')
  console.log('✅ forgetscan telegram notify loaded')
} catch (e) {
  console.warn('⚠️ forgetscan telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') return
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ forgetscan telegram notify failed:', e?.response?.data || e?.message)
  }
}

const { broadcastForgetScanRequest } = require('../../utils/forgetScan.realtime')

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitForget(req, doc, event = 'forgetscan:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastForgetScanRequest(io, doc, event)
  } catch (e) {
    console.warn('⚠️ forgetscan realtime emit failed:', e?.message)
  }
}


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

/** for LEAVE_USER create flow: employeeId should be loginId/employeeId from token */
function actorEmployeeId(req) {
  return s(req.user?.employeeId || req.user?.empId || req.user?.loginId || req.user?.id || '')
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
}

function hasRole(req, ...allow) {
  const roles = getRoles(req)
  const a = allow.map(up)
  return roles.some((r) => a.includes(r))
}

// ✅ can VIEW inbox pages
function canViewManagerInbox(req) {
  return hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewGmInbox(req) {
  return hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewCooInbox(req) {
  return hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}

// ✅ can DECIDE (NO admin bypass)
function canManagerDecide(req) {
  return hasRole(req, 'LEAVE_MANAGER')
}
function canGmDecide(req) {
  return hasRole(req, 'LEAVE_GM')
}
function canCooDecide(req) {
  return hasRole(req, 'LEAVE_COO')
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

function normalizeMode(v) {
  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  return 'MANAGER_AND_GM'
}

function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_GM'
  return 'PENDING_MANAGER'
}

function buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const need = (label, v) => {
    const id = s(v)
    if (!id) throw createError(400, `${label} approver is missing in profile`)
    return id
  }

  if (m === 'MANAGER_AND_GM') {
    return [
      { level: 'MANAGER', loginId: need('Manager', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'GM', loginId: need('GM', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  if (m === 'MANAGER_AND_COO') {
    return [
      { level: 'MANAGER', loginId: need('Manager', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'COO', loginId: need('COO', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  if (m === 'GM_AND_COO') {
    return [
      { level: 'GM', loginId: need('GM', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'COO', loginId: need('COO', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  // fallback
  return [
    { level: 'MANAGER', loginId: need('Manager', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
    { level: 'GM', loginId: need('GM', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
  ]
}

function markApproval(approvals, level, status, note = '') {
  const arr = Array.isArray(approvals) ? approvals : []
  const lvl = up(level)
  const idx = arr.findIndex((a) => up(a.level) === lvl)
  if (idx >= 0) {
    arr[idx].status = status
    arr[idx].actedAt = new Date()
    arr[idx].note = s(note || '')
  }
  return arr
}

function nextStatusAfterManagerApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'MANAGER_AND_COO') return 'PENDING_COO'
  return 'PENDING_GM'
}

function nextStatusAfterGmApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_COO'
  return 'APPROVED'
}

function nextStatusAfterCooApprove() {
  return 'APPROVED'
}

async function attachEmployeeInfo(rows = []) {
  const ids = [...new Set((rows || []).map((d) => s(d.employeeId)).filter(Boolean))]
  if (!ids.length) return rows

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [s(e.employeeId), e]))

  return (rows || []).map((d) => {
    const emp = map.get(s(d.employeeId))
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
  const employeeId = s(raw.employeeId)
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

/* ─────────────────────────────────────────────────────────────
   CREATE (employee)
   POST /api/leave/forget-scan
───────────────────────────────────────────────────────────── */
exports.createMyForgetScan = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const employeeId = actorEmployeeId(req)
    if (!employeeId) throw createError(400, 'Missing employeeId/loginId in token')

    const forgotDate = s(req.body?.forgotDate)
    const forgotType = up(req.body?.forgotType)
    const reason = s(req.body?.reason)

    if (!isValidYMD(forgotDate)) throw createError(400, 'forgotDate must be YYYY-MM-DD')
    if (!['FORGET_IN', 'FORGET_OUT'].includes(forgotType)) {
      throw createError(400, 'forgotType must be FORGET_IN or FORGET_OUT')
    }
    if (!reason) throw createError(400, 'reason is required')

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    const mode = normalizeMode(prof.approvalMode)

    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    // ensure required approvers exist for that mode
    buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId })

    let doc
    try {
      doc = await ExpatForgetScanRequest.create({
        employeeId,
        requesterLoginId: meLoginId,

        forgotDate,
        forgotType,
        reason,

        approvalMode: mode,
        managerLoginId,
        gmLoginId,
        cooLoginId,

        status: initialStatusForMode(mode),
        approvals: buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }),
      })
    } catch (e) {
      // unique index duplicate => treat as friendly 409
      if (e?.code === 11000) {
        throw createError(409, 'You already submitted this forget scan request (same date and type).')
      }
      throw e
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:created')
    await safeNotify(notify?.notifyAdminsOnCreate, payload)
    await safeNotify(notify?.notifyForgetCreatedToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)
    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   LIST MY REQUESTS
   GET /api/leave/forget-scan/my
───────────────────────────────────────────────────────────── */
exports.listMyForgetScans = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const rows = await ExpatForgetScanRequest.find({ requesterLoginId: meLoginId })
      .sort({ createdAt: -1 })
      .lean()

    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   CANCEL MY REQUEST
   POST /api/leave/forget-scan/:id/cancel
───────────────────────────────────────────────────────────── */
exports.cancelMyForgetScan = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    // employees can only cancel their own request; admins can cancel any (viewer only)
    if (!isAdminViewer(req) && s(existing.requesterLoginId) !== meLoginId) {
      throw createError(403, 'Not your request')
    }

    if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(up(existing.status))) {
      throw createError(400, `Request is ${existing.status}. Cannot cancel.`)
    }

    existing.status = 'CANCELLED'
    existing.cancelledAt = new Date()
    existing.cancelledBy = meLoginId
    await existing.save()

    const payload = await attachEmployeeInfoToOne(existing)
    emitForget(req, payload, 'forgetscan:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCancelledToEmployee, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   UPDATE MY REQUEST (employee)
   PATCH /api/leave/forget-scan/:id
   body: { forgotDate, forgotType, reason }
───────────────────────────────────────────────────────────── */
exports.updateMyForgetScan = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    // ✅ owner only (NO admin bypass for edit)
    if (s(existing.requesterLoginId) !== meLoginId) {
      throw createError(403, 'Not your request')
    }

    // ✅ only pending statuses
    const st = up(existing.status)
    if (!['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(st)) {
      throw createError(400, `Request is ${existing.status}. Cannot edit.`)
    }

    // ✅ cannot edit after any approval action (strict)
    const approvals = Array.isArray(existing.approvals) ? existing.approvals : []
    const anyApproved = approvals.some((a) => up(a?.status) === 'APPROVED')
    const anyRejected = approvals.some((a) => up(a?.status) === 'REJECTED')
    const anyActed = approvals.some((a) => !!a?.actedAt)
    if (anyApproved || anyRejected || anyActed) {
      throw createError(400, 'Cannot edit after any approval action.')
    }

    // input
    const forgotDate = s(req.body?.forgotDate)
    const forgotType = up(req.body?.forgotType)
    const reason = s(req.body?.reason)

    if (!isValidYMD(forgotDate)) throw createError(400, 'forgotDate must be YYYY-MM-DD')
    if (!['FORGET_IN', 'FORGET_OUT'].includes(forgotType)) {
      throw createError(400, 'forgotType must be FORGET_IN or FORGET_OUT')
    }
    if (!reason) throw createError(400, 'reason is required')

    // ✅ update (keep approvalMode/approvers/status/approvals unchanged)
    existing.forgotDate = forgotDate
    existing.forgotType = forgotType
    existing.reason = reason
    existing.updatedAt = new Date()

    try {
      await existing.save()
    } catch (e) {
      if (e?.code === 11000) {
        throw createError(409, 'You already submitted this forget scan request (same date and type).')
      }
      throw e
    }

    const payload = await attachEmployeeInfoToOne(existing)
    emitForget(req, payload, 'forgetscan:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX
   GET /api/leave/forget-scan/manager/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO'] }

    // Admin viewer: keep scope logic
    if (isAdminViewer(req)) {
      const scope = up(req.query?.scope || '')
      const query =
        scope === 'ALL'
          ? { approvalMode: modeFilter }
          : { approvalMode: modeFilter, status: 'PENDING_MANAGER' }

      const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
      return res.json(await attachEmployeeInfo(rows || []))
    }

    // ✅ Manager: can see pending manager + later (history)
    const query = {
      approvalMode: modeFilter,
      managerLoginId: me,
      status: { $in: ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] },
    }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION
   POST /api/leave/forget-scan/:id/manager-decision
   body: { action: APPROVE|REJECT, comment? }
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    if (s(existing.managerLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_MANAGER') {
      throw createError(400, `Request is ${existing.status}. Manager can only decide when status is PENDING_MANAGER.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterManagerApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_MANAGER', managerLoginId: me },
      {
        $set: {
          status: newStatus,
          managerComment: s(comment || ''),
          managerDecisionAt: new Date(),
          approvals: markApproval(existing.approvals, 'MANAGER', act === 'APPROVE' ? 'APPROVED' : 'REJECTED', comment),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyManagerDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM INBOX
   GET /api/leave/forget-scan/gm/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewGmInbox(req)) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_GM', 'GM_AND_COO'] }

    if (isAdminViewer(req)) {
      const scope = up(req.query?.scope || '')
      const query =
        scope === 'ALL'
          ? { approvalMode: modeFilter }
          : { approvalMode: modeFilter, status: 'PENDING_GM' }

      const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
      return res.json(await attachEmployeeInfo(rows || []))
    }

    // ✅ GM: queue + history
    // - MANAGER_AND_GM: can see only PENDING_GM + final states (no PENDING_MANAGER)
    // - GM_AND_COO: can see PENDING_GM + PENDING_COO + final states
    const query = {
      gmLoginId: me,
      $or: [
        {
          approvalMode: 'MANAGER_AND_GM',
          status: { $in: ['PENDING_GM', 'APPROVED', 'REJECTED', 'CANCELLED'] },
        },
        {
          approvalMode: 'GM_AND_COO',
          status: { $in: ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] },
        },
      ],
    }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION
   POST /api/leave/forget-scan/:id/gm-decision
   body: { action: APPROVE|REJECT, comment? }
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'GM_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require GM approval.')
    }

    if (s(existing.gmLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_GM') {
      throw createError(400, `Request is ${existing.status}. GM can only decide when status is PENDING_GM.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterGmApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_GM', gmLoginId: me },
      {
        $set: {
          status: newStatus,
          gmComment: s(comment || ''),
          gmDecisionAt: new Date(),
          approvals: markApproval(existing.approvals, 'GM', act === 'APPROVE' ? 'APPROVED' : 'REJECTED', comment),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyGmDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO INBOX
   GET /api/leave/forget-scan/coo/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listCooInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewCooInbox(req)) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_COO', 'GM_AND_COO'] }

    if (isAdminViewer(req)) {
      const scope = up(req.query?.scope || '')
      const query =
        scope === 'ALL'
          ? { approvalMode: modeFilter }
          : { approvalMode: modeFilter, status: 'PENDING_COO' }

      const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
      return res.json(await attachEmployeeInfo(rows || []))
    }

    // ✅ COO: queue + history (only from COO step onward)
    const query = {
      approvalMode: modeFilter,
      cooLoginId: me,
      status: { $in: ['PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] },
    }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION
   POST /api/leave/forget-scan/:id/coo-decision
   body: { action: APPROVE|REJECT, comment? }
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_COO', 'GM_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require COO approval.')
    }

    if (s(existing.cooLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_COO') {
      throw createError(400, `Request is ${existing.status}. COO can only decide when status is PENDING_COO.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterCooApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_COO', cooLoginId: me },
      {
        $set: {
          status: newStatus,
          cooComment: s(comment || ''),
          cooDecisionAt: new Date(),
          approvals: markApproval(existing.approvals, 'COO', act === 'APPROVE' ? 'APPROVED' : 'REJECTED', comment),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCooDecisionToEmployee, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LIST (viewer)
   GET /api/leave/forget-scan/admin?employeeId=&status=&from=&to=&limit=&skip=
───────────────────────────────────────────────────────────── */
exports.adminList = async (req, res, next) => {
  try {
    if (!isAdminViewer(req)) throw createError(403, 'Forbidden')

    const employeeId = s(req.query.employeeId)
    const status = up(req.query.status)
    const from = s(req.query.from)
    const to = s(req.query.to)

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)
    const skip = Math.max(Number(req.query.skip || 0), 0)

    const q = {}
    if (employeeId) q.employeeId = employeeId
    if (status && ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
      q.status = status
    }
    if (isValidYMD(from) || isValidYMD(to)) {
      q.forgotDate = {}
      if (isValidYMD(from)) q.forgotDate.$gte = from
      if (isValidYMD(to)) q.forgotDate.$lte = to
    }

    const rows = await ExpatForgetScanRequest.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GET ONE (viewer)
   GET /api/leave/forget-scan/:id
───────────────────────────────────────────────────────────── */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params
    const doc = await ExpatForgetScanRequest.findById(id)
    if (!doc) throw createError(404, 'Request not found')

    const me = actorLoginId(req)
    const roles = getRoles(req)

    // owner can view
    const isOwner = s(doc.requesterLoginId) === me

    // assigned approvers can view
    const isManager = roles.includes('LEAVE_MANAGER') && s(doc.managerLoginId) === me
    const isGm = roles.includes('LEAVE_GM') && s(doc.gmLoginId) === me
    const isCoo = roles.includes('LEAVE_COO') && s(doc.cooLoginId) === me

    if (!isOwner && !isManager && !isGm && !isCoo && !isAdminViewer(req)) {
      throw createError(403, 'Forbidden')
    }

    return res.json(await attachEmployeeInfoToOne(doc))
  } catch (e) {
    next(e)
  }
}