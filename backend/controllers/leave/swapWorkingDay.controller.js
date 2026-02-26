/* eslint-disable no-console */
// backend/controllers/leave/swapWorkingDayRequest.controller.js
//
// ✅ UPDATED to support NEW approval modes from LeaveProfile:
//    - MANAGER_ONLY : PENDING_MANAGER -> APPROVED
//    - GM_ONLY      : PENDING_GM      -> APPROVED
//
// ✅ UPDATED lock rule:
//    - Once ANY approval activity happened (actedAt / APPROVED / REJECTED),
//      requester CANNOT edit or cancel.
//
// ✅ REMOVED attachments usage:
//    - Controller no longer reads/writes attachments from request body
//    - (Evidence endpoints can remain in a separate controller if you have one;
//       this file does not use attachments anymore.)

const createError = require('http-errors')

const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const { isWorkingDay } = require('../../utils/leave.rules')

/* ───────────────── notify (Telegram) ───────────────── */
let notify = null
try {
  notify = require('../../services/telegram/swap')
  console.log('✅ swap telegram notify loaded')
} catch (e) {
  console.warn('⚠️ swap telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') {
      console.warn('⚠️ Telegram notify skipped (fn not a function)')
      return
    }
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ Telegram notify failed:', e?.response?.data || e?.message)
  }
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

function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}

function ensureOwner(doc, loginId) {
  if (s(doc.requesterLoginId) !== s(loginId)) throw createError(403, 'Not your request')
}

function assertYMD(x, label) {
  const v = s(x)
  if (!isValidYMD(v)) throw createError(400, `${label} must be YYYY-MM-DD`)
  return v
}

function ymdToUtcDate(ymd) {
  const [y, m, d] = s(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0))
}

function* iterYmdInclusive(startYmd, endYmd) {
  const a = ymdToUtcDate(startYmd)
  const b = ymdToUtcDate(endYmd)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return
  if (b.getTime() < a.getTime()) return

  const oneDay = 24 * 60 * 60 * 1000
  for (let t = a.getTime(); t <= b.getTime(); t += oneDay) {
    yield new Date(t).toISOString().slice(0, 10)
  }
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return s(aStart) <= s(bEnd) && s(aEnd) >= s(bStart)
}

/** ✅ support old numeric employeeId data + new string employeeId */
function buildEmpIdIn(employeeId) {
  const sid = String(employeeId || '').trim()
  const n = Number(sid)
  const list = [sid]
  if (Number.isFinite(n)) list.push(n)
  return { $in: [...new Set(list)] }
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || req.user?.empId || '')
}

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

function canViewManagerInbox(req) {
  return hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewGmInbox(req) {
  return hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewCooInbox(req) {
  return hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}

function canManagerDecide(req) {
  return hasRole(req, 'LEAVE_MANAGER')
}
function canGmDecide(req) {
  return hasRole(req, 'LEAVE_GM')
}
function canCooDecide(req) {
  return hasRole(req, 'LEAVE_COO')
}

/* ✅ lock edit/cancel once ANY approval activity happened */
function hasAnyApprovalActivity(approvals) {
  const arr = Array.isArray(approvals) ? approvals : []
  return arr.some((a) => {
    const st = up(a?.status)
    return !!a?.actedAt || st === 'APPROVED' || st === 'REJECTED'
  })
}
function ensureRequesterCanEditOrCancel(doc) {
  if (hasAnyApprovalActivity(doc?.approvals)) {
    throw createError(400, 'This request already started approval. You cannot edit or cancel it.')
  }
}

/* ───────────────── realtime ───────────────── */

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitSwap(req, payload, event = 'swap:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return

    const empId = s(payload?.employeeId)
    const requester = s(payload?.requesterLoginId)

    const manager = s(payload?.managerLoginId)
    const gm = s(payload?.gmLoginId)
    const coo = s(payload?.cooLoginId)

    const st = up(payload?.status)

    io.to('admins').emit(event, payload)
    if (empId) io.to(`employee:${empId}`).emit(event, payload)
    if (requester) io.to(`user:${requester}`).emit(event, payload)
    if (empId) io.to(`user:${empId}`).emit(event, payload) // optional fallback

    // current approver first (inbox realtime)
    if (st === 'PENDING_MANAGER' && manager) {
      io.to(`user:${manager}`).emit(event, payload)
      return
    }
    if (st === 'PENDING_GM' && gm) {
      io.to(`user:${gm}`).emit(event, payload)
      return
    }
    if (st === 'PENDING_COO' && coo) {
      io.to(`user:${coo}`).emit(event, payload)
      return
    }

    // otherwise broadcast to all approvers
    if (manager) io.to(`user:${manager}`).emit(event, payload)
    if (gm) io.to(`user:${gm}`).emit(event, payload)
    if (coo) io.to(`user:${coo}`).emit(event, payload)
  } catch (e) {
    console.warn('⚠️ emitSwap failed:', e?.message)
  }
}

/* ───────────────── attach employee info ───────────────── */

async function attachEmployeeInfo(rows = []) {
  const ids = [...new Set((rows || []).map((d) => s(d.employeeId)).filter(Boolean))]
  if (!ids.length) return rows

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [s(e.employeeId), e]))

  return (rows || []).map((d) => {
    const emp = map.get(s(d.employeeId))
    return {
      ...d,
      employeeName: emp?.name || emp?.fullName || d.employeeName || '',
      department: emp?.departmentName || emp?.department || d.department || '',
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
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  return {
    ...raw,
    employeeName: emp?.name || emp?.fullName || raw.employeeName || '',
    department: emp?.departmentName || emp?.department || raw.department || '',
  }
}

/* ───────────────── approval mode helpers ───────────────── */

function normalizeMode(v) {
  return SwapWorkingDayRequest.normalizeMode ? SwapWorkingDayRequest.normalizeMode(v) : up(v)
}

function allowedStatusesForInboxLevel(level) {
  const lvl = up(level)
  if (lvl === 'MANAGER') return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  if (lvl === 'GM') return ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  if (lvl === 'COO') return ['PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
}

function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_AND_COO') return 'PENDING_GM'
  if (m === 'GM_ONLY') return 'PENDING_GM' // ✅ NEW
  // MANAGER_AND_GM / MANAGER_AND_COO / MANAGER_ONLY
  return 'PENDING_MANAGER'
}

function buildApprovalsOrThrow(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const reqLogin = (label, id) => {
    const v = s(id)
    if (!v) throw createError(400, `${label} is required for approvalMode ${m}`)
    return v
  }

  if (m === 'MANAGER_ONLY') {
    return [{ level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' }]
  }

  if (m === 'GM_ONLY') {
    return [{ level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' }]
  }

  if (m === 'MANAGER_AND_GM') {
    return [
      { level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  if (m === 'MANAGER_AND_COO') {
    return [
      { level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'COO', loginId: reqLogin('cooLoginId', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  // GM_AND_COO
  return [
    { level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    { level: 'COO', loginId: reqLogin('cooLoginId', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
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
  if (m === 'MANAGER_ONLY') return 'APPROVED' // ✅ NEW
  if (m === 'MANAGER_AND_COO') return 'PENDING_COO'
  return 'PENDING_GM'
}

function nextStatusAfterGmApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_ONLY') return 'APPROVED' // ✅ NEW
  if (m === 'GM_AND_COO') return 'PENDING_COO'
  return 'APPROVED'
}

function nextStatusAfterCooApprove() {
  return 'APPROVED'
}

/* ───────────────── validation rules ───────────────── */

function countCalendarDays(startYmd, endYmd) {
  let c = 0
  for (const _ of iterYmdInclusive(startYmd, endYmd)) c += 1
  return c
}

function countWorkingDays(startYmd, endYmd) {
  let c = 0
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (isWorkingDay(d)) c += 1
  }
  return c
}

function ensurePending(doc) {
  const st = up(doc.status)
  if (!st.startsWith('PENDING')) throw createError(400, `Only pending requests can be edited. Current status: ${doc.status}`)
}

function assertRangeOrder(startYmd, endYmd, label) {
  if (s(endYmd) < s(startYmd)) throw createError(400, `${label} endDate must be >= startDate`)
}

function assertAllNonWorking(startYmd, endYmd, label) {
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (isWorkingDay(d)) throw createError(400, `${label} must be non-working day(s). "${d}" is a working day.`)
  }
}

function assertAllWorking(startYmd, endYmd, label) {
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (!isWorkingDay(d)) throw createError(400, `${label} must be working day(s). "${d}" is not a working day.`)
  }
}

async function assertNoSwapOverlap({ employeeId, reqStart, reqEnd, offStart, offEnd, excludeId = null }) {
  const query = {
    employeeId: buildEmpIdIn(employeeId),
    status: { $nin: ['REJECTED', 'CANCELLED'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }

  const existing = await SwapWorkingDayRequest.find(query)
    .select('requestStartDate requestEndDate offStartDate offEndDate status')
    .lean()

  for (const r of existing || []) {
    const rReqS = s(r.requestStartDate)
    const rReqE = s(r.requestEndDate)
    const rOffS = s(r.offStartDate)
    const rOffE = s(r.offEndDate)

    const hit =
      dateRangesOverlap(reqStart, reqEnd, rReqS, rReqE) ||
      dateRangesOverlap(reqStart, reqEnd, rOffS, rOffE) ||
      dateRangesOverlap(offStart, offEnd, rReqS, rReqE) ||
      dateRangesOverlap(offStart, offEnd, rOffS, rOffE)

    if (hit) throw createError(409, 'You already have a Swap Working Day request that overlaps these dates. Please select other dates.')
  }
}

/* ───────────────── decision parsing ───────────────── */

function parseDecisionBody(req) {
  const body = req.body || {}
  const actionRaw = body.action || body.decision
  const note = s(body.note || body.comment || body.reason || '')
  const act = up(actionRaw)

  let action = ''
  if (act === 'APPROVE' || act === 'APPROVED') action = 'APPROVE'
  else if (act === 'REJECT' || act === 'REJECTED') action = 'REJECT'
  else throw createError(400, 'Invalid action')

  if (action === 'REJECT' && !note) throw createError(400, 'Reject requires a reason.')
  return { action, note }
}

/* ─────────────────────────────────────────────────────────────
   CREATE (LEAVE_USER)
───────────────────────────────────────────────────────────── */
exports.createMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    if (!loginId) throw createError(400, 'Missing user identity')
    if (!employeeId) throw createError(400, 'Missing employeeId/loginId in token')

    const prof = await LeaveProfile.findOne({ employeeId: s(employeeId) }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    const mode = normalizeMode(prof.approvalMode)
    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    const requestStartDate = assertYMD(req.body?.requestStartDate, 'requestStartDate')
    const requestEndDate = assertYMD(req.body?.requestEndDate, 'requestEndDate')
    const offStartDate = assertYMD(req.body?.offStartDate, 'offStartDate')
    const offEndDate = assertYMD(req.body?.offEndDate, 'offEndDate')

    assertRangeOrder(requestStartDate, requestEndDate, 'request')
    assertRangeOrder(offStartDate, offEndDate, 'off')

    if (dateRangesOverlap(requestStartDate, requestEndDate, offStartDate, offEndDate)) {
      throw createError(400, 'request dates and off dates cannot overlap.')
    }

    assertAllNonWorking(requestStartDate, requestEndDate, 'request dates')
    assertAllWorking(offStartDate, offEndDate, 'off dates')

    const requestTotalDays = countCalendarDays(requestStartDate, requestEndDate)
    const offTotalDays = countWorkingDays(offStartDate, offEndDate)

    if (!requestTotalDays || requestTotalDays <= 0) throw createError(400, 'Invalid request date range')
    if (!offTotalDays || offTotalDays <= 0) throw createError(400, 'Invalid off date range')

    if (requestTotalDays !== offTotalDays) {
      throw createError(400, `Total days must match. requestDays=${requestTotalDays}, offDays=${offTotalDays}`)
    }

    await assertNoSwapOverlap({
      employeeId,
      reqStart: requestStartDate,
      reqEnd: requestEndDate,
      offStart: offStartDate,
      offEnd: offEndDate,
    })

    const approvals = buildApprovalsOrThrow(mode, { managerLoginId, gmLoginId, cooLoginId })
    const status = initialStatusForMode(mode)

    const doc = await SwapWorkingDayRequest.create({
      employeeId: s(employeeId),
      requesterLoginId: loginId,

      requestStartDate,
      requestEndDate,
      offStartDate,
      offEndDate,
      requestTotalDays,
      offTotalDays,

      reason: s(req.body?.reason || ''),

      approvalMode: mode,
      status,

      managerLoginId,
      gmLoginId,
      cooLoginId,

      approvals,

      // ✅ attachments NOT used here
      attachments: [],
    })

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:created')

    // ✅ Telegram: employee confirm + current approver DM
    await safeNotify(notify?.notifyAdminsOnCreate, payload)
    await safeNotify(notify?.notifySwapRequestCreated, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)

    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   LIST MY
───────────────────────────────────────────────────────────── */
exports.listMySwapRequests = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const rows = await SwapWorkingDayRequest.find({ requesterLoginId: loginId }).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   CANCEL MY  ✅ LOCK if any approval activity happened
───────────────────────────────────────────────────────────── */
exports.cancelMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await SwapWorkingDayRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    ensureOwner(existing, loginId)
    ensureRequesterCanEditOrCancel(existing)

    if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(up(existing.status))) {
      throw createError(400, `Request is ${existing.status}. Cannot cancel.`)
    }

    existing.status = 'CANCELLED'
    existing.cancelledAt = new Date()
    existing.cancelledBy = loginId
    await existing.save()

    const payload = await attachEmployeeInfoToOne(existing)
    emitSwap(req, payload, 'swap:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifySwapCancelledToEmployee, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX  ✅ includes MANAGER_ONLY
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'] }

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, managerLoginId: me }

    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_MANAGER' }
      : scope === 'ALL'
        ? { ...base, status: { $in: allowedStatusesForInboxLevel('MANAGER') } }
        : { ...base, status: 'PENDING_MANAGER' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION ✅ supports MANAGER_ONLY
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await SwapWorkingDayRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    if (s(existing.managerLoginId) !== me) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_MANAGER') {
      throw createError(400, `Request is ${existing.status}. Manager can only decide when status is PENDING_MANAGER.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterManagerApprove(mode) : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            managerComment: s(note || ''),
            managerDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            managerComment: '',
            managerDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: me,
            rejectedLevel: 'MANAGER',
          }

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_MANAGER', managerLoginId: me },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'MANAGER', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyManagerDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload) // next approver (if any)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM INBOX ✅ includes GM_ONLY
───────────────────────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewGmInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'] }

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, gmLoginId: me }

    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_GM' }
      : scope === 'ALL'
        ? { ...base, status: { $in: allowedStatusesForInboxLevel('GM') } }
        : { ...base, status: 'PENDING_GM' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION ✅ supports GM_ONLY
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await SwapWorkingDayRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require GM approval.')
    }

    if (s(existing.gmLoginId) !== me) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_GM') {
      throw createError(400, `Request is ${existing.status}. GM can only decide when status is PENDING_GM.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterGmApprove(mode) : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            gmComment: s(note || ''),
            gmDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            gmComment: '',
            gmDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: me,
            rejectedLevel: 'GM',
          }

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_GM', gmLoginId: me },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'GM', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyGmDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload) // next approver (if any)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO INBOX (COO only in MANAGER_AND_COO / GM_AND_COO)
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

    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_COO' }
      : scope === 'ALL'
        ? { ...base, status: { $in: allowedStatusesForInboxLevel('COO') } }
        : { ...base, status: 'PENDING_COO' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await SwapWorkingDayRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_COO', 'GM_AND_COO'].includes(mode)) {
      throw createError(400, 'This request does not require COO approval.')
    }

    if (s(existing.cooLoginId) !== me) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_COO') {
      throw createError(400, `Request is ${existing.status}. COO can only decide when status is PENDING_COO.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterCooApprove() : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            cooComment: s(note || ''),
            cooDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            cooComment: '',
            cooDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: me,
            rejectedLevel: 'COO',
          }

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_COO', cooLoginId: me },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'COO', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCooDecisionToEmployee, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LIST (VIEW)
───────────────────────────────────────────────────────────── */
exports.adminList = async (req, res, next) => {
  try {
    if (!isAdminViewer(req)) throw createError(403, 'Forbidden')

    const employeeId = s(req.query?.employeeId)
    const status = up(req.query?.status)
    const from = s(req.query?.from)
    const to = s(req.query?.to)

    const limitRaw = Number(req.query?.limit || 200)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200

    const q = {}
    if (employeeId) q.employeeId = buildEmpIdIn(employeeId)
    if (status) q.status = status

    if (from && isValidYMD(from) && to && isValidYMD(to)) q.requestStartDate = { $gte: from, $lte: to }
    else if (from && isValidYMD(from)) q.requestStartDate = { $gte: from }
    else if (to && isValidYMD(to)) q.requestStartDate = { $lte: to }

    const rows = await SwapWorkingDayRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GET ONE (VIEW)
───────────────────────────────────────────────────────────── */
exports.getOne = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Request not found')

    const canView =
      isAdminViewer(req) ||
      s(doc.requesterLoginId) === me ||
      s(doc.managerLoginId) === me ||
      s(doc.gmLoginId) === me ||
      s(doc.cooLoginId) === me

    if (!canView) throw createError(403, 'Forbidden')

    const payload = await attachEmployeeInfoToOne(doc)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   UPDATE (LEAVE_USER) ✅ LOCK if any approval activity happened
───────────────────────────────────────────────────────────── */
exports.updateMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)
    if (!loginId) throw createError(400, 'Missing user identity')
    if (!employeeId) throw createError(400, 'Missing employeeId in token')

    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    ensureOwner(doc, loginId)
    ensurePending(doc)
    ensureRequesterCanEditOrCancel(doc)

    const requestStartDate = assertYMD(req.body?.requestStartDate, 'requestStartDate')
    const requestEndDate = assertYMD(req.body?.requestEndDate, 'requestEndDate')
    const offStartDate = assertYMD(req.body?.offStartDate, 'offStartDate')
    const offEndDate = assertYMD(req.body?.offEndDate, 'offEndDate')

    assertRangeOrder(requestStartDate, requestEndDate, 'request')
    assertRangeOrder(offStartDate, offEndDate, 'off')

    if (dateRangesOverlap(requestStartDate, requestEndDate, offStartDate, offEndDate)) {
      throw createError(400, 'request dates and off dates cannot overlap.')
    }

    assertAllNonWorking(requestStartDate, requestEndDate, 'request dates')
    assertAllWorking(offStartDate, offEndDate, 'off dates')

    const requestTotalDays = countCalendarDays(requestStartDate, requestEndDate)
    const offTotalDays = countWorkingDays(offStartDate, offEndDate)

    if (!requestTotalDays || requestTotalDays <= 0) throw createError(400, 'Invalid request date range')
    if (!offTotalDays || offTotalDays <= 0) throw createError(400, 'Invalid off date range')

    if (requestTotalDays !== offTotalDays) {
      throw createError(400, `Total days must match. requestDays=${requestTotalDays}, offDays=${offTotalDays}`)
    }

    await assertNoSwapOverlap({
      employeeId,
      reqStart: requestStartDate,
      reqEnd: requestEndDate,
      offStart: offStartDate,
      offEnd: offEndDate,
      excludeId: id,
    })

    doc.requestStartDate = requestStartDate
    doc.requestEndDate = requestEndDate
    doc.offStartDate = offStartDate
    doc.offEndDate = offEndDate
    doc.requestTotalDays = requestTotalDays
    doc.offTotalDays = offTotalDays
    doc.reason = s(req.body?.reason || '')

    // ✅ attachments NOT used here
    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')
    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER BULK DECISION ✅ supports MANAGER_ONLY
───────────────────────────────────────────────────────────── */
exports.managerBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await SwapWorkingDayRequest.find({
      _id: { $in: ids },
      status: 'PENDING_MANAGER',
      managerLoginId: me,
      approvalMode: { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'] },
    })

    if (!docs.length) {
      return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })
    }

    const ops = docs.map((d) => {
      const mode = normalizeMode(d.approvalMode)
      const newStatus = action === 'APPROVE' ? nextStatusAfterManagerApprove(mode) : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              managerComment: s(note || ''),
              managerDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              managerComment: '',
              managerDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'MANAGER',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_MANAGER', managerLoginId: me },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'MANAGER', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await SwapWorkingDayRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await SwapWorkingDayRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitSwap(req, p, 'swap:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyManagerDecisionToEmployee, p)
      if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM BULK DECISION ✅ supports GM_ONLY
───────────────────────────────────────────────────────────── */
exports.gmBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await SwapWorkingDayRequest.find({
      _id: { $in: ids },
      status: 'PENDING_GM',
      gmLoginId: me,
      approvalMode: { $in: ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'] },
    })

    if (!docs.length) {
      return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })
    }

    const ops = docs.map((d) => {
      const mode = normalizeMode(d.approvalMode)
      const newStatus = action === 'APPROVE' ? nextStatusAfterGmApprove(mode) : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              gmComment: s(note || ''),
              gmDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              gmComment: '',
              gmDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'GM',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_GM', gmLoginId: me },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'GM', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await SwapWorkingDayRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await SwapWorkingDayRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitSwap(req, p, 'swap:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyGmDecisionToEmployee, p)
      if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO BULK DECISION (COO only in MANAGER_AND_COO / GM_AND_COO)
───────────────────────────────────────────────────────────── */
exports.cooBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await SwapWorkingDayRequest.find({
      _id: { $in: ids },
      status: 'PENDING_COO',
      cooLoginId: me,
      approvalMode: { $in: ['MANAGER_AND_COO', 'GM_AND_COO'] },
    })

    if (!docs.length) {
      return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })
    }

    const ops = docs.map((d) => {
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              cooComment: s(note || ''),
              cooDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              cooComment: '',
              cooDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'COO',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_COO', cooLoginId: me },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'COO', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await SwapWorkingDayRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await SwapWorkingDayRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitSwap(req, p, 'swap:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyCooDecisionToEmployee, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}