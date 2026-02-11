/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js
//
// ✅ Supports ONLY 3 approval modes (semantic):
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Flow by mode:
//    MANAGER_AND_GM   : PENDING_MANAGER -> PENDING_GM  -> APPROVED
//    MANAGER_AND_COO  : PENDING_MANAGER -> PENDING_COO -> APPROVED
//    GM_AND_COO       : PENDING_GM      -> PENDING_COO -> APPROVED   (manager skipped)
//
// ✅ Status values:
//    PENDING_MANAGER, PENDING_GM, PENDING_COO, APPROVED, REJECTED, CANCELLED
//
// ✅ Realtime + Telegram (best-effort) + recalc profile after decision

const createError = require('http-errors')

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { computeBalances, validateAndNormalizeRequest } = require('../../utils/leave.rules')
const { broadcastLeaveRequest, broadcastLeaveProfile } = require('../../utils/leave.realtime')

// Optional Telegram notify service (best-effort)
let notify = null
try {
  notify = require('../../services/leave/leave.telegram.notify')
} catch (e) {
  notify = null
}

/* ───────────────── helpers ───────────────── */

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

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
}

function hasRole(req, ...allow) {
  const roles = getRoles(req)
  const a = allow.map(up)
  return roles.some((r) => a.includes(r))
}

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitReq(req, docOrPlain, event = 'leave:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastLeaveRequest(io, docOrPlain, event)
  } catch (e) {
    console.warn(`⚠️ realtime emitReq(${event}) failed:`, e?.message)
  }
}

function emitProfile(req, docOrPlain, event = 'leave:profile:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastLeaveProfile(io, docOrPlain, event)
  } catch (e) {
    console.warn(`⚠️ realtime emitProfile(${event}) failed:`, e?.message)
  }
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn === 'function') return await fn(...args)
  } catch (e) {
    console.warn('⚠️ Telegram notify failed:', e?.message)
  }
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

/**
 * Recalc balances for profile and emit
 */
async function recalcAndEmitProfile(req, employeeId) {
  try {
    const empId = s(employeeId)
    if (!empId) return

    const prof = await LeaveProfile.findOne({ employeeId: empId })
    if (!prof) return

    const approved = await LeaveRequest.find({ employeeId: empId, status: 'APPROVED' })
      .sort({ startDate: 1 })
      .lean()

    const snap = computeBalances(prof.toObject ? prof.toObject() : prof, approved, new Date())

    const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
    const nextAsOf = s(snap?.meta?.asOfYMD || prof.balancesAsOf || '')
    const nextEnd = snap?.meta?.contractYear?.endDate ? s(snap.meta.contractYear.endDate) : s(prof.contractEndDate)

    let changed = false
    if (JSON.stringify(prof.balances || []) !== JSON.stringify(nextBalances)) {
      prof.balances = nextBalances
      changed = true
    }
    if (nextAsOf && s(prof.balancesAsOf) !== nextAsOf) {
      prof.balancesAsOf = nextAsOf
      changed = true
    }
    if (nextEnd && s(prof.contractEndDate) !== nextEnd) {
      prof.contractEndDate = nextEnd
      changed = true
    }

    if (changed) await prof.save()
    emitProfile(req, prof, 'leave:profile:updated')
  } catch (e) {
    console.warn('⚠️ recalcAndEmitProfile failed:', e?.message)
  }
}

/* ───────────────── mode logic ───────────────── */

function normalizeMode(v) {
  return LeaveRequest.normalizeMode ? LeaveRequest.normalizeMode(v) : up(v)
}

/**
 * Determine initial status from approvalMode
 */
function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_GM'
  return 'PENDING_MANAGER'
}

/**
 * Build approvals steps array from mode + approvers
 * - we include steps even if loginId empty, but mark SKIPPED
 *   (helps preview/history be consistent)
 */
function buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const steps = []
  const push = (level, loginId) => {
    const id = s(loginId)
    steps.push({
      level,
      loginId: id || '-', // keep something for UI/debug
      status: id ? 'PENDING' : 'SKIPPED',
      actedAt: null,
      note: '',
    })
  }

  if (m === 'MANAGER_AND_GM') {
    push('MANAGER', managerLoginId)
    push('GM', gmLoginId)
  } else if (m === 'MANAGER_AND_COO') {
    push('MANAGER', managerLoginId)
    push('COO', cooLoginId)
  } else if (m === 'GM_AND_COO') {
    push('GM', gmLoginId)
    push('COO', cooLoginId)
  } else {
    push('MANAGER', managerLoginId)
    push('GM', gmLoginId)
  }

  // ensure unique by level (keep first)
  const seen = new Set()
  return steps.filter((x) => {
    const key = up(x.level)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Update approvals array to reflect decisions
 */
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

/**
 * After manager approves, decide next status by mode
 */
function nextStatusAfterManagerApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'MANAGER_AND_COO') return 'PENDING_COO'
  return 'PENDING_GM' // MANAGER_AND_GM
}

/**
 * After GM approves, decide next status by mode
 */
function nextStatusAfterGmApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_COO'
  return 'APPROVED' // MANAGER_AND_GM ends at GM
}

/**
 * After COO approves, always final approve
 */
function nextStatusAfterCooApprove(_mode) {
  return 'APPROVED'
}

/* ─────────────────────────────────────────────────────────────
   CREATE (employee)
   POST /api/leave/requests
───────────────────────────────────────────────────────────── */
exports.createMyRequest = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const employeeId = s(req.user?.employeeId || req.user?.empId || '')
    if (!employeeId) throw createError(400, 'Missing employeeId in token')

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    // Determine semantic mode from profile (profile might store old enum)
    const mode = normalizeMode(prof.approvalMode)

    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    // Validate + normalize request dates / half logic using leave.rules.js
    const normalized = validateAndNormalizeRequest
      ? validateAndNormalizeRequest(
          {
            leaveTypeCode: req.body?.leaveTypeCode,
            startDate: req.body?.startDate,
            endDate: req.body?.endDate,
            startHalf: req.body?.startHalf,
            endHalf: req.body?.endHalf,
            isHalfDay: req.body?.isHalfDay,
            dayPart: req.body?.dayPart,
            totalDays: req.body?.totalDays,
            reason: req.body?.reason,
          },
          { profile: prof }
        )
      : req.body

    const doc = await LeaveRequest.create({
      employeeId,
      requesterLoginId: meLoginId,

      leaveTypeCode: normalized.leaveTypeCode,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      startHalf: normalized.startHalf ?? null,
      endHalf: normalized.endHalf ?? null,
      isHalfDay: !!normalized.isHalfDay,
      dayPart: normalized.dayPart ?? null,
      totalDays: Number(normalized.totalDays),

      reason: s(normalized.reason || ''),

      approvalMode: mode,
      status: initialStatusForMode(mode),

      managerLoginId,
      gmLoginId,
      cooLoginId,

      approvals: buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }),
    })

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:created')

    await safeNotify(notify?.notifyLeaveRequestCreated, doc)

    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   LIST MY REQUESTS
   GET /api/leave/requests/my
───────────────────────────────────────────────────────────── */
exports.listMyRequests = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const rows = await LeaveRequest.find({ requesterLoginId: meLoginId })
      .sort({ createdAt: -1 })
      .lean()

    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   CANCEL MY REQUEST
   POST /api/leave/requests/:id/cancel
───────────────────────────────────────────────────────────── */
exports.cancelMyRequest = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

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
    emitReq(req, payload, 'leave:req:updated')

    await safeNotify(notify?.notifyLeaveRequestCancelled, existing)

    // no need to recalc (cancelled pending), but safe:
    await recalcAndEmitProfile(req, existing.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX
   GET /api/leave/requests/manager/inbox
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO'] }

    const query = isAdminViewer(req)
      ? { status: 'PENDING_MANAGER', approvalMode: modeFilter }
      : { status: 'PENDING_MANAGER', approvalMode: modeFilter, managerLoginId: me }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION
   POST /api/leave/requests/:id/manager-decision
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    if (!isAdminViewer(req) && s(existing.managerLoginId) !== me) {
      throw createError(403, 'Not your request')
    }

    if (s(existing.status) !== 'PENDING_MANAGER') {
      throw createError(400, `Request is ${existing.status}. Manager can only decide when status is PENDING_MANAGER.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterManagerApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    // race-safe update (also pins approvalMode to avoid weird legacy mismatch)
    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_MANAGER', approvalMode: existing.approvalMode },
      {
        $set: {
          status: newStatus,
          managerComment: s(comment || ''),
          managerDecisionAt: new Date(),
          approvals: markApproval(
            existing.approvals,
            'MANAGER',
            act === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            comment
          ),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await LeaveRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    await safeNotify(notify?.notifyManagerDecisionToEmployee, doc)
    await safeNotify(notify?.notifyLeaveAdminManagerDecision, doc)

    if (act === 'APPROVE') {
      if (newStatus === 'PENDING_GM') await safeNotify(notify?.notifyManagerApprovedToGm, doc)
      if (newStatus === 'PENDING_COO') await safeNotify(notify?.notifyManagerApprovedToCoo, doc)
    }

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM INBOX
   GET /api/leave/requests/gm/inbox
───────────────────────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_GM', 'GM_AND_COO'] }

    const query = isAdminViewer(req)
      ? { status: 'PENDING_GM', approvalMode: modeFilter }
      : { status: 'PENDING_GM', approvalMode: modeFilter, gmLoginId: me }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION
   POST /api/leave/requests/:id/gm-decision
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'GM_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require GM approval.')
    }

    if (!isAdminViewer(req) && s(existing.gmLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_GM') {
      throw createError(400, `Request is ${existing.status}. GM can only decide when status is PENDING_GM.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterGmApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_GM', approvalMode: existing.approvalMode },
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
      const latest = await LeaveRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    await safeNotify(notify?.notifyGmDecisionToEmployee, doc)
    await safeNotify(notify?.notifyLeaveAdminGmDecision, doc)

    if (act === 'APPROVE' && newStatus === 'PENDING_COO') {
      await safeNotify(notify?.notifyGmApprovedToCoo, doc)
    }

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO INBOX
   GET /api/coo/leave/requests/inbox   (your coo routes already use another controller, but now unified)
   - COO sees PENDING_COO for modes that include COO:
     MANAGER_AND_COO, GM_AND_COO
───────────────────────────────────────────────────────────── */
exports.listCooInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const modeFilter = { $in: ['MANAGER_AND_COO', 'GM_AND_COO'] }

    const query = isAdminViewer(req)
      ? { status: 'PENDING_COO', approvalMode: modeFilter }
      : { status: 'PENDING_COO', approvalMode: modeFilter, cooLoginId: me }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION
   POST /api/coo/leave/requests/:id/decision
   body: { action: "APPROVE"|"REJECT", comment?: string }
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    if (!hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_COO', 'GM_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require COO approval.')
    }

    if (!isAdminViewer(req) && s(existing.cooLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_COO') {
      throw createError(400, `Request is ${existing.status}. COO can only decide when status is PENDING_COO.`)
    }

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterCooApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_COO', approvalMode: existing.approvalMode },
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
      const latest = await LeaveRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    await safeNotify(notify?.notifyCooDecisionToEmployee, doc)
    await safeNotify(notify?.notifyLeaveAdminCooDecision, doc)
    await safeNotify(notify?.notifyCooDecisionToGm, doc)

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}
