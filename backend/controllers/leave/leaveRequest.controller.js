/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js
//
// ✅ Viewers: LEAVE_ADMIN/ADMIN/ROOT_ADMIN can VIEW inbox (pending + ALL via scope)
// ❌ But they CANNOT approve/reject on behalf of manager/gm/coo
//
// ✅ Supports approval modes (semantic):
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//    - MANAGER_ONLY      ✅ NEW
//    - GM_ONLY           ✅ NEW
//
// ✅ Flow by mode:
//    MANAGER_AND_GM   : PENDING_MANAGER -> PENDING_GM  -> APPROVED
//    MANAGER_AND_COO  : PENDING_MANAGER -> PENDING_COO -> APPROVED
//    GM_AND_COO       : PENDING_GM      -> PENDING_COO -> APPROVED   (manager skipped)
//    MANAGER_ONLY     : PENDING_MANAGER -> APPROVED
//    GM_ONLY          : PENDING_GM      -> APPROVED
//
// ✅ Status values:
//    PENDING_MANAGER, PENDING_GM, PENDING_COO, APPROVED, REJECTED, CANCELLED
//
// ✅ Realtime + Telegram (best-effort) + recalc profile after decision
//
// ✅ NEW: STRICT duplicate prevention per date+half
//    - blocks only same date+half slot (AM/PM)
//    - allows AM if only PM exists, and vice versa
//    - full-day blocks both halves

const createError = require('http-errors')

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { computeBalances, validateAndNormalizeRequest } = require('../../utils/leave.rules')
const { broadcastLeaveRequest, broadcastLeaveProfile } = require('../../utils/leave.realtime')

// Optional Telegram notify service (best-effort)
let notify = null
try {
  notify = require('../../services/telegram/leave')
  console.log('✅ leave telegram notify loaded:', Object.keys(notify || {}))
} catch (e) {
  console.warn('⚠️ leave telegram notify NOT loaded:', e?.message)
  notify = null
}

/* ───────────────── helpers ───────────────── */

function allowedStatusesForInboxLevel(level) {
  const lvl = up(level)
  if (lvl === 'MANAGER') {
    // manager can see everything under manager flows (including pending_manager)
    return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  }
  if (lvl === 'GM') {
    // GM should NOT see PENDING_MANAGER
    return ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  }
  if (lvl === 'COO') {
    // COO should NOT see PENDING_MANAGER or PENDING_GM
    return ['PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  }
  return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
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

function requiresAttachmentForDoc(doc) {
  const t = up(doc?.leaveTypeCode)
  const days = Number(doc?.totalDays || 0)

  if (t === 'MA') return true
  if (t === 'BL') return true
  if ((t === 'SP' || t === 'SL') && days >= 3) return true

  return false
}

function hasAnyApprovalActivity(doc) {
  const approvals = Array.isArray(doc?.approvals) ? doc.approvals : []
  return approvals.some((a) => {
    const st = up(a?.status)
    return !!a?.actedAt || st === 'APPROVED' || st === 'REJECTED'
  })
}

function assertAttachmentIfRequired(doc) {
  if (!requiresAttachmentForDoc(doc)) return
  const count = Array.isArray(doc.attachments) ? doc.attachments.length : 0
  if (count <= 0) throw createError(400, 'Attachment is required for this leave request.')
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
  if (m === 'GM_ONLY') return 'PENDING_GM' // ✅ NEW
  // MANAGER_AND_GM / MANAGER_AND_COO / MANAGER_ONLY
  return 'PENDING_MANAGER'
}

function buildApprovals(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)

  const need = (label, v) => {
    const id = s(v)
    if (!id) throw createError(400, `${label} approver is missing in profile`)
    return id
  }

  if (m === 'MANAGER_ONLY') {
    return [
      { level: 'MANAGER', loginId: need('Manager', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }

  if (m === 'GM_ONLY') {
    return [
      { level: 'GM', loginId: need('GM', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
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

  // safest fallback
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

/* ─────────────────────────────────────────────────────────────
   ✅ NEW: STRICT no-duplicate date+half guard
───────────────────────────────────────────────────────────── */

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

function ymdFromAny(v) {
  if (!v) return ''
  if (typeof v === 'string') {
    const t = v.trim()
    if (isValidYMD(t)) return t
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function toUtcDateFromYmd(ymd) {
  if (!isValidYMD(ymd)) return null
  return new Date(`${ymd}T00:00:00.000Z`)
}

/** ✅ support old numeric employeeId data + new string employeeId */
function buildEmpIdIn(employeeId) {
  const sid = String(employeeId || '').trim()
  const n = Number(sid)
  const list = [sid]
  if (Number.isFinite(n)) list.push(n)
  return { $in: [...new Set(list)] }
}

function normHalf(v) {
  const h = up(v)
  if (!h) return ''
  if (h === 'AM' || h === 'PM') return h
  if (h === 'MORNING') return 'AM'
  if (h === 'AFTERNOON') return 'PM'
  // keep only AM/PM
  return ''
}

function addSlot(map, dateYmd, half /* 'AM'|'PM' */) {
  if (!dateYmd || !half) return
  if (!map.has(dateYmd)) map.set(dateYmd, { AM: false, PM: false })
  const obj = map.get(dateYmd)
  obj[half] = true
}

function addFullDay(map, dateYmd) {
  addSlot(map, dateYmd, 'AM')
  addSlot(map, dateYmd, 'PM')
}

function* iterYmdInclusive(startYmd, endYmd) {
  const sdt = toUtcDateFromYmd(startYmd)
  const edt = toUtcDateFromYmd(endYmd)
  if (!sdt || !edt) return
  const oneDay = 24 * 60 * 60 * 1000
  for (let t = sdt.getTime(); t <= edt.getTime(); t += oneDay) {
    yield new Date(t).toISOString().slice(0, 10)
  }
}

/**
 * Convert ONE leave request into occupied date-half slots.
 * Rules:
 * - single day:
 *   - half-day => only AM or PM
 *   - full-day => AM+PM
 * - multi-day:
 *   - first day: startHalf=PM => PM only, else full
 *   - last day : endHalf=AM  => AM only, else full
 *   - middle days => full
 *
 * Supports legacy:
 * - isHalfDay + dayPart (AM/PM)
 */
function requestToSlots(reqDoc) {
  const slots = new Map()

  const startYmd = ymdFromAny(reqDoc?.startDate)
  const endYmd = ymdFromAny(reqDoc?.endDate || reqDoc?.startDate)
  if (!startYmd || !endYmd) return slots

  const startHalf = normHalf(reqDoc?.startHalf)
  const endHalf = normHalf(reqDoc?.endHalf)

  // legacy half-day on single day
  const legacyHalf = !!reqDoc?.isHalfDay
  const legacyPart = normHalf(reqDoc?.dayPart)

  if (startYmd === endYmd) {
    // single day
    const half = startHalf || endHalf || (legacyHalf ? legacyPart : '')
    if (half === 'AM' || half === 'PM') addSlot(slots, startYmd, half)
    else addFullDay(slots, startYmd)
    return slots
  }

  // multi-day
  for (const d of iterYmdInclusive(startYmd, endYmd)) {
    if (d === startYmd) {
      if (startHalf === 'PM') addSlot(slots, d, 'PM')
      else addFullDay(slots, d) // startHalf AM or null => full day
      continue
    }
    if (d === endYmd) {
      if (endHalf === 'AM') addSlot(slots, d, 'AM')
      else addFullDay(slots, d) // endHalf PM or null => full day
      continue
    }
    addFullDay(slots, d)
  }

  return slots
}

function hasSlotConflict(existingSlots, desiredSlots) {
  for (const [date, dSlots] of desiredSlots.entries()) {
    const eSlots = existingSlots.get(date)
    if (!eSlots) continue
    if ((dSlots.AM && eSlots.AM) || (dSlots.PM && eSlots.PM)) return true
  }
  return false
}

/**
 * STRICT per employee:
 * - compare occupied AM/PM slots across existing requests
 * - ignore only REJECTED / CANCELLED
 * - excludeId used for update
 */
async function assertNoDuplicateDateHalf({ employeeId, normalized, excludeId = null }) {
  const empId = s(employeeId)
  if (!empId) return

  const desiredSlots = requestToSlots(normalized)
  if (!desiredSlots.size) return

  const query = {
    employeeId: buildEmpIdIn(empId),
    status: { $nin: ['REJECTED', 'CANCELLED'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }

  const existing = await LeaveRequest.find(query)
    .select('startDate endDate startHalf endHalf isHalfDay dayPart status')
    .lean()

  const occupied = new Map()
  for (const r of existing || []) {
    const s2 = requestToSlots(r)
    for (const [date, halves] of s2.entries()) {
      if (!occupied.has(date)) occupied.set(date, { AM: false, PM: false })
      const cur = occupied.get(date)
      cur.AM = cur.AM || !!halves.AM
      cur.PM = cur.PM || !!halves.PM
    }
  }

  if (hasSlotConflict(occupied, desiredSlots)) {
    throw createError(409, 'You already requested leave for this day/half. Please select another day or half.')
  }
}

/* ─────────────────────────────────────────────────────────────
   CREATE (employee)
   POST /api/leave/requests
   NOTE: Attachments are uploaded AFTER create via:
         POST /api/leave/requests/:id/attachments
   So we cannot hard-block here for required-attachment types.
   We enforce required attachments at APPROVAL time (manager/gm/coo).
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

    // ✅ NEW: block duplicate same date+half (allow AM if only PM exists, etc.)
    await assertNoDuplicateDateHalf({ employeeId, normalized })

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

    await safeNotify(notify?.notifyAdminsOnCreate, payload)
    await safeNotify(notify?.notifyCreatedToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)

    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   LIST MY REQUESTS
───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   CANCEL MY REQUEST
───────────────────────────────────────────── */
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
    if (hasAnyApprovalActivity(existing)) {
      throw createError(400, 'This request has already been processed. Cannot cancel.')
    }

    existing.status = 'CANCELLED'
    existing.cancelledAt = new Date()
    existing.cancelledBy = meLoginId
    await existing.save()

    const payload = await attachEmployeeInfoToOne(existing)
    emitReq(req, payload, 'leave:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCancelledToEmployee, payload)

    await recalcAndEmitProfile(req, existing.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   MANAGER INBOX
───────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '') // 'ALL' or ''
    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'] } // ✅ NEW

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

/* ─────────────────────────────────────────────
   MANAGER DECISION
───────────────────────────────────────────── */
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
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    if (s(existing.managerLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_MANAGER') {
      throw createError(400, `Request is ${existing.status}. Manager can only decide when status is PENDING_MANAGER.`)
    }

    const act = up(action)

    // ✅ ENFORCE REQUIRED ATTACHMENT (MA / BL / Sick >= 3)
    if (act === 'APPROVE') assertAttachmentIfRequired(existing)

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

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyManagerDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)

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

/* ─────────────────────────────────────────────
   GM INBOX
───────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewGmInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'] } // ✅ NEW

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, gmLoginId: me }

    // ✅ IMPORTANT: non-admin "scope=ALL" still must respect flow
    const query = isAdminViewer(req)
      ? (scope === 'ALL' ? { ...base } : { ...base, status: 'PENDING_GM' })
      : (scope === 'ALL'
          ? { ...base, status: { $in: allowedStatusesForInboxLevel('GM') } }
          : { ...base, status: 'PENDING_GM' })

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   GM DECISION
───────────────────────────────────────────── */
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
    if (!['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require GM approval.')
    }

    if (s(existing.gmLoginId) !== me) throw createError(403, 'Not your request')

    if (s(existing.status) !== 'PENDING_GM') {
      throw createError(400, `Request is ${existing.status}. GM can only decide when status is PENDING_GM.`)
    }

    const act = up(action)

    // ✅ ENFORCE REQUIRED ATTACHMENT (MA / BL / Sick >= 3)
    if (act === 'APPROVE') assertAttachmentIfRequired(existing)

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

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyGmDecisionToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)

    if (act === 'APPROVE' && newStatus === 'PENDING_COO') {
      await safeNotify(notify?.notifyGmApprovedToCoo, doc)
    }

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   COO INBOX
───────────────────────────────────────────── */
exports.listCooInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewCooInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_COO', 'GM_AND_COO'] } // (no COO in new modes)

    const base = isAdminViewer(req)
      ? { approvalMode: modeFilter }
      : { approvalMode: modeFilter, cooLoginId: me }

    // ✅ IMPORTANT: non-admin "scope=ALL" still must respect flow
    const query = isAdminViewer(req)
      ? (scope === 'ALL' ? { ...base } : { ...base, status: 'PENDING_COO' })
      : (scope === 'ALL'
          ? { ...base, status: { $in: allowedStatusesForInboxLevel('COO') } }
          : { ...base, status: 'PENDING_COO' })

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   COO DECISION
───────────────────────────────────────────── */
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

    // ✅ ENFORCE REQUIRED ATTACHMENT (MA / BL / Sick >= 3)
    if (act === 'APPROVE') assertAttachmentIfRequired(existing)

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

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCooDecisionToEmployee, payload)

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────
   UPDATE MY REQUEST (only before any approval happened)
───────────────────────────────────────────── */
exports.updateMyRequest = async (req, res, next) => {
  try {
    const meLoginId = actorLoginId(req)
    if (!meLoginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const existing = await LeaveRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    // ✅ only owner can edit (admins can extend later if you want)
    if (s(existing.requesterLoginId) !== meLoginId) {
      throw createError(403, 'Not your request')
    }

    // ✅ must still be pending somewhere
    const st = up(existing.status)
    if (!['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(st)) {
      throw createError(400, `Request is ${existing.status}. Cannot edit.`)
    }

    // ✅ "edit only when not yet got any approved"
    const approvals = Array.isArray(existing.approvals) ? existing.approvals : []
    const anyApproved = approvals.some((a) => up(a.status) === 'APPROVED')
    const anyRejected = approvals.some((a) => up(a.status) === 'REJECTED')
    const anyActed = approvals.some((a) => !!a.actedAt)

    if (anyApproved || anyRejected || anyActed) {
      throw createError(400, 'This request has already been processed. Cannot edit.')
    }

    // ✅ validate new dates/type/half using the same rules
    const vr = validateAndNormalizeRequest({
      leaveTypeCode: req.body?.leaveTypeCode ?? existing.leaveTypeCode,
      startDate: req.body?.startDate ?? existing.startDate,
      endDate: req.body?.endDate ?? existing.endDate,
      startHalf: req.body?.startHalf,
      endHalf: req.body?.endHalf,
      isHalfDay: req.body?.isHalfDay,
      dayPart: req.body?.dayPart,
    })

    if (!vr || vr.ok === false) {
      throw createError(400, vr?.message || 'Invalid leave request')
    }

    const normalized = vr.normalized

    // ✅ NEW: block duplicate same date+half, excluding this request itself
    await assertNoDuplicateDateHalf({
      employeeId: existing.employeeId,
      normalized,
      excludeId: existing._id,
    })

    // ✅ update allowed fields
    existing.leaveTypeCode = normalized.leaveTypeCode
    existing.startDate = normalized.startDate
    existing.endDate = normalized.endDate

    existing.startHalf = normalized.startHalf ?? null
    existing.endHalf = normalized.endHalf ?? null

    existing.isHalfDay = !!normalized.isHalfDay
    existing.dayPart = normalized.dayPart ?? null

    existing.totalDays = Number(normalized.totalDays)
    existing.reason = s(req.body?.reason ?? existing.reason)

    // keep status/mode/approvers same
    await existing.save()

    const payload = await attachEmployeeInfoToOne(existing)
    emitReq(req, payload, 'leave:req:updated')

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}