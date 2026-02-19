/* eslint-disable no-console */
// backend/controllers/leave/swapWorkingDayRequest.controller.js
//
// ✅ Swap Working Day (NOT Replace Day)
// ✅ Roles:
//    - LEAVE_USER: create/list/cancel own requests
//    - LEAVE_ADMIN/ADMIN/ROOT_ADMIN: can VIEW inbox (but cannot decide)
//    - LEAVE_MANAGER / LEAVE_GM / LEAVE_COO: can decide at their level (NO admin bypass)
//
// ✅ Only 3 approval modes (semantic):
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Flow:
//    MANAGER_AND_GM   : PENDING_MANAGER -> PENDING_GM  -> APPROVED
//    MANAGER_AND_COO  : PENDING_MANAGER -> PENDING_COO -> APPROVED
//    GM_AND_COO       : PENDING_GM      -> PENDING_COO -> APPROVED
//
// ✅ NO "SKIPPED" anywhere (approvals are only PENDING/APPROVED/REJECTED)
//
// ✅ Validation (strict, you can relax later if needed):
//    - request range = NON-working days (Sunday or holiday)
//    - off range     = WORKING days (Mon–Sat, not holiday)
//    - totals must match (calendar count of request days == working-day count of off days)
//    - cannot overlap between request range and off range
//    - prevent duplicates: cannot overlap with any existing swap request (except REJECTED/CANCELLED)
//
// ✅ Attachments stored via GridFS (metadata in doc.attachments)
//    - this controller just accepts attachments[] metadata from body

const createError = require('http-errors')

const SwapWorkingDayRequest = require('../../models/leave/SwapWorkingDayRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { isWorkingDay } = require('../../utils/leave.rules')

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
  // safe UTC midnight
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

// can VIEW inbox
function canViewManagerInbox(req) {
  return hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewGmInbox(req) {
  return hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewCooInbox(req) {
  return hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}

// can DECIDE (NO admin bypass)
function canManagerDecide(req) {
  return hasRole(req, 'LEAVE_MANAGER')
}
function canGmDecide(req) {
  return hasRole(req, 'LEAVE_GM')
}
function canCooDecide(req) {
  return hasRole(req, 'LEAVE_COO')
}

// optional strict duration check
function calcDaysInclusive(start, end) {
  const a = new Date(`${start}T00:00:00.000Z`).getTime()
  const b = new Date(`${end}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  const diff = Math.floor((b - a) / 86400000)
  return diff + 1
}

/* ───────────────── realtime (simple, safe) ───────────────── */

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitSwap(req, payload, event = 'swap:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return

    const empId = s(payload?.employeeId)
    const requester = s(payload?.requesterLoginId)

    // broadcast to admins + the employee/user rooms (match your leave realtime style)
    io.to('admins').emit(event, payload)
    if (empId) io.to(`employee:${empId}`).emit(event, payload)
    if (requester) io.to(`user:${requester}`).emit(event, payload)
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

function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  return m === 'GM_AND_COO' ? 'PENDING_GM' : 'PENDING_MANAGER'
}

/**
 * ✅ NO SKIP:
 * - if a required approver loginId is missing => throw 400
 * - steps include only the required levels for that mode
 */
function buildApprovalsOrThrow(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const reqLogin = (label, id) => {
    const v = s(id)
    if (!v) throw createError(400, `${label} is required for approvalMode ${m}`)
    return v
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
  return m === 'MANAGER_AND_COO' ? 'PENDING_COO' : 'PENDING_GM'
}

function nextStatusAfterGmApprove(mode) {
  const m = normalizeMode(mode)
  return m === 'GM_AND_COO' ? 'PENDING_COO' : 'APPROVED'
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
  if (!st.startsWith('PENDING')) {
    throw createError(400, `Only pending requests can be edited. Current status: ${doc.status}`)
  }
}

function assertRangeOrder(startYmd, endYmd, label) {
  if (s(endYmd) < s(startYmd)) throw createError(400, `${label} endDate must be >= startDate`)
}

function assertAllNonWorking(startYmd, endYmd, label) {
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (isWorkingDay(d)) {
      throw createError(400, `${label} must be non-working day(s). "${d}" is a working day.`)
    }
  }
}

function assertAllWorking(startYmd, endYmd, label) {
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (!isWorkingDay(d)) {
      throw createError(400, `${label} must be working day(s). "${d}" is not a working day.`)
    }
  }
}

function normalizeAttachments(arr) {
  const list = Array.isArray(arr) ? arr : []
  return list
    .map((a) => ({
      attId: s(a?.attId),
      fileId: a?.fileId, // keep as-is (ObjectId string ok)
      filename: s(a?.filename),
      contentType: s(a?.contentType),
      size: Number(a?.size || 0) || 0,
      uploadedAt: a?.uploadedAt ? new Date(a.uploadedAt) : new Date(),
      uploadedBy: s(a?.uploadedBy),
      note: s(a?.note),
    }))
    .filter((a) => a.attId && a.fileId)
}

/**
 * ✅ Prevent duplicates / overlaps:
 * - no overlap with ANY existing swap request of this employee
 * - compare both request-range and off-range
 * - ignore REJECTED/CANCELLED
 * - excludeId for update (if you add update later)
 */
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

    if (hit) {
      throw createError(409, 'You already have a Swap Working Day request that overlaps these dates. Please select other dates.')
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   CREATE (LEAVE_USER)
   POST /api/leave/swap-working-day
───────────────────────────────────────────────────────────── */
exports.createMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    if (!loginId) throw createError(400, 'Missing user identity')
    if (!employeeId) throw createError(400, 'Missing employeeId/loginId in token')

    // require profile so we can read approvers + approvalMode
    const prof = await LeaveProfile.findOne({ employeeId: s(employeeId) }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    const mode = normalizeMode(prof.approvalMode)
    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    // dates
    const requestStartDate = assertYMD(req.body?.requestStartDate, 'requestStartDate')
    const requestEndDate = assertYMD(req.body?.requestEndDate, 'requestEndDate')
    const offStartDate = assertYMD(req.body?.offStartDate, 'offStartDate')
    const offEndDate = assertYMD(req.body?.offEndDate, 'offEndDate')

    assertRangeOrder(requestStartDate, requestEndDate, 'request')
    assertRangeOrder(offStartDate, offEndDate, 'off')

    // cannot overlap inside the same request
    if (dateRangesOverlap(requestStartDate, requestEndDate, offStartDate, offEndDate)) {
      throw createError(400, 'request dates and off dates cannot overlap.')
    }

    // strict type of days (you can relax later)
    assertAllNonWorking(requestStartDate, requestEndDate, 'request dates')
    assertAllWorking(offStartDate, offEndDate, 'off dates')

    const requestTotalDays = countCalendarDays(requestStartDate, requestEndDate)
    const offTotalDays = countWorkingDays(offStartDate, offEndDate)

    if (!requestTotalDays || requestTotalDays <= 0) throw createError(400, 'Invalid request date range')
    if (!offTotalDays || offTotalDays <= 0) throw createError(400, 'Invalid off date range')

    if (requestTotalDays !== offTotalDays) {
      throw createError(400, `Total days must match. requestDays=${requestTotalDays}, offDays=${offTotalDays}`)
    }

    // prevent overlap with existing swap requests
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
      attachments: normalizeAttachments(req.body?.attachments),
    })

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:created')

    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   LIST MY SWAP REQUESTS
   GET /api/leave/swap-working-day/my
───────────────────────────────────────────────────────────── */
exports.listMySwapRequests = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const rows = await SwapWorkingDayRequest.find({ requesterLoginId: loginId })
      .sort({ createdAt: -1 })
      .lean()

    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   CANCEL MY SWAP REQUEST
   POST /api/leave/swap-working-day/:id/cancel
───────────────────────────────────────────────────────────── */
exports.cancelMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await SwapWorkingDayRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    // owner can cancel; admins can cancel any
    if (!isAdminViewer(req) && s(existing.requesterLoginId) !== loginId) {
      throw createError(403, 'Not your request')
    }

    if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(up(existing.status))) {
      throw createError(400, `Request is ${existing.status}. Cannot cancel.`)
    }

    existing.status = 'CANCELLED'
    existing.cancelledAt = new Date()
    existing.cancelledBy = loginId
    await existing.save()

    const payload = await attachEmployeeInfoToOne(existing)
    emitSwap(req, payload, 'swap:req:updated')

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX
   GET /api/leave/swap-working-day/manager/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO'] }

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, managerLoginId: me }

    const query = scope === 'ALL' ? base : { ...base, status: 'PENDING_MANAGER' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION
   POST /api/leave/swap-working-day/:id/manager-decision
   body: { action:"APPROVE"|"REJECT", comment?:string }
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await SwapWorkingDayRequest.findById(id)
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

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
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
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM INBOX
   GET /api/leave/swap-working-day/gm/inbox?scope=ALL
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

    const query = scope === 'ALL' ? base : { ...base, status: 'PENDING_GM' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION
   POST /api/leave/swap-working-day/:id/gm-decision
   body: { action:"APPROVE"|"REJECT", comment?:string }
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await SwapWorkingDayRequest.findById(id)
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

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
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
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO INBOX
   GET /api/leave/swap-working-day/coo/inbox?scope=ALL
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

    const query = scope === 'ALL' ? base : { ...base, status: 'PENDING_COO' }

    const rows = await SwapWorkingDayRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION
   POST /api/leave/swap-working-day/:id/coo-decision
   body: { action:"APPROVE"|"REJECT", comment?:string }
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

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

    const act = up(action)
    if (act === 'REJECT' && !s(comment)) throw createError(400, 'Reject requires a reason.')

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextStatusAfterCooApprove(mode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else throw createError(400, 'Invalid action')

    const doc = await SwapWorkingDayRequest.findOneAndUpdate(
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
      const latest = await SwapWorkingDayRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitSwap(req, payload, 'swap:req:updated')

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LIST (VIEW/SEARCH) - view only
   GET /api/leave/swap-working-day/admin?employeeId=&status=&from=&to=&limit=
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

    // filter by requestStartDate range (simple + predictable)
    if (from && isValidYMD(from) && to && isValidYMD(to)) {
      q.requestStartDate = { $gte: from, $lte: to }
    } else if (from && isValidYMD(from)) {
      q.requestStartDate = { $gte: from }
    } else if (to && isValidYMD(to)) {
      q.requestStartDate = { $lte: to }
    }

    const rows = await SwapWorkingDayRequest.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GET ONE (VIEW) - owner OR assigned approver OR admin
   GET /api/leave/swap-working-day/:id
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

/**
 * ✅ PUT /api/leave/swap-working-day/:id
 * Body:
 *  requestStartDate, requestEndDate, offStartDate, offEndDate, reason
 */
exports.updateMySwapRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await SwapWorkingDayRequest.findById(id)
    if (!doc) throw createError(404, 'Swap request not found')

    ensureOwner(doc, loginId)
    ensurePending(doc)

    const requestStartDate = assertYMD(req.body.requestStartDate, 'requestStartDate')
    const requestEndDate = assertYMD(req.body.requestEndDate || req.body.requestStartDate, 'requestEndDate')
    const offStartDate = assertYMD(req.body.offStartDate, 'offStartDate')
    const offEndDate = assertYMD(req.body.offEndDate || req.body.offStartDate, 'offEndDate')

    // optional: validate working days (use your rule)
    if (!isWorkingDay(requestStartDate) || !isWorkingDay(requestEndDate)) {
      throw createError(400, 'Request dates must be working days.')
    }
    if (!isWorkingDay(offStartDate) || !isWorkingDay(offEndDate)) {
      throw createError(400, 'Compensatory dates must be working days.')
    }

    // ensure ranges
    if (requestStartDate > requestEndDate) throw createError(400, 'Request date range invalid.')
    if (offStartDate > offEndDate) throw createError(400, 'Compensatory date range invalid.')

    const reqDays = calcDaysInclusive(requestStartDate, requestEndDate)
    const offDays = calcDaysInclusive(offStartDate, offEndDate)
    if (!reqDays || reqDays !== offDays) {
      throw createError(400, 'Compensatory days must equal request days.')
    }

    doc.requestStartDate = requestStartDate
    doc.requestEndDate = requestEndDate
    doc.offStartDate = offStartDate
    doc.offEndDate = offEndDate
    doc.reason = s(req.body.reason || '')

    await doc.save()

    return res.json({
      success: true,
      _id: String(doc._id),
      requestStartDate: doc.requestStartDate,
      requestEndDate: doc.requestEndDate,
      offStartDate: doc.offStartDate,
      offEndDate: doc.offEndDate,
      reason: doc.reason,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      attachments: doc.attachments || [],
    })
  } catch (e) {
    next(e)
  }
}