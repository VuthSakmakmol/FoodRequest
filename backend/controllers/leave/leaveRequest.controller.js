/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js
//
// ✅ Viewers: LEAVE_ADMIN/ADMIN/ROOT_ADMIN can VIEW inbox (pending + ALL via scope)
// ❌ But they CANNOT approve/reject on behalf of manager/gm/coo
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
  return hasRole(req, 'LEAVE_MANAGER') // only actual manager role
}
function canGmDecide(req) {
  return hasRole(req, 'LEAVE_GM')
}
function canCooDecide(req) {
  return hasRole(req, 'LEAVE_COO')
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

function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_GM'
  return 'PENDING_MANAGER'
}

function buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const steps = []
  const push = (level, loginId) => {
    const id = s(loginId)
    steps.push({
      level,
      loginId: id || '-',
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

  const seen = new Set()
  return steps.filter((x) => {
    const key = up(x.level)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

/* ─────────────────────────────────────────────────────────────
   CREATE (employee)
   POST /api/leave/requests
───────────────────────────────────────────────────────────── */
exports.createMyRequest = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const employeeId = s(req.user?.employeeId || req.user?.empId || req.user?.loginId || req.user?.id || '')
    if (!employeeId) throw createError(400, 'Missing employeeId/loginId in token')

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    const mode = normalizeMode(prof.approvalMode)

    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    const vr = validateAndNormalizeRequest({
      leaveTypeCode: req.body?.leaveTypeCode,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      startHalf: req.body?.startHalf,
      endHalf: req.body?.endHalf,
      isHalfDay: req.body?.isHalfDay,
      dayPart: req.body?.dayPart,
    })

    if (!vr || vr.ok === false) {
      throw createError(400, vr?.message || 'Invalid leave request')
    }

    const normalized = vr.normalized

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

      reason: s(req.body?.reason || ''),

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

    // employees can only cancel their own request; admins can cancel any
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

    await recalcAndEmitProfile(req, existing.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX
   GET /api/leave/requests/manager/inbox?scope=ALL
   - default (no scope): pending only
   - scope=ALL: show all statuses for that manager (history view)
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '') // 'ALL' or ''
    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO'] }

    // ✅ Admin viewers can view all managers; normal manager sees only own rows
    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, managerLoginId: me }

    const query =
      scope === 'ALL'
        ? { ...base } // all statuses
        : { ...base, status: 'PENDING_MANAGER' } // inbox pending only

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION
   POST /api/leave/requests/:id/manager-decision
   body: { action:"APPROVE"|"REJECT", comment?:string }
   ❌ Admin cannot decide on behalf of manager
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    // ✅ must be the assigned manager
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

    const doc = await LeaveRequest.findOneAndUpdate(
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
   GET /api/leave/requests/gm/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewGmInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'GM_AND_COO'] }

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, gmLoginId: me }

    const query =
      scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_GM' }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION
   POST /api/leave/requests/:id/gm-decision
   ❌ Admin cannot decide on behalf of GM
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
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

    const doc = await LeaveRequest.findOneAndUpdate(
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
   GET /api/leave/requests/coo/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listCooInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewCooInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_COO', 'GM_AND_COO'] }

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, cooLoginId: me }

    const query =
      scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_COO' }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION
   POST /api/leave/requests/:id/coo-decision
   ❌ Admin cannot decide on behalf of COO
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
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

    const doc = await LeaveRequest.findOneAndUpdate(
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
