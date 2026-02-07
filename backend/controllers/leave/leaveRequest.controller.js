/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js
//
// ✅ UPDATED: Admin has NO approval stage.
// Approval chain is ONLY:
//   1) Manager (optional)
//   2) GM
//   3) COO (only when mode = GM_AND_COO)
//
// UI Modes (semantic):
//   - MANAGER_AND_GM
//   - GM_AND_COO
//
// DB might store legacy enum values (depends on schema):
//   - ADMIN_AND_GM
//   - GM_OR_COO
// etc.
//
// This file AUTO-MAPS semantic <-> stored enum so your UI can use MANAGER_AND_GM safely.

const createError = require('http-errors')

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { getLeaveType } = require('../../config/leaveSystemTypes')
const { validateAndNormalizeRequest, computeBalances } = require('../../utils/leave.rules')

const notify = require('../../services/leave/leave.telegram.notify')

// ✅ FIX: use leave realtime broadcaster
const { broadcastLeaveRequest, broadcastLeaveProfile } = require('../../utils/leave.realtime')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

/* ───────────────── helpers ───────────────── */

function s(v) {
  return String(v ?? '').trim()
}

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

/** Prefer loginId first */
function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '')
}

function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map((r) => s(r).toUpperCase()))].filter(Boolean)
}

/** Admin is VIEWER only */
function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
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
    if (typeof fn === 'function') await fn(...args)
  } catch (e) {
    console.warn('⚠️ notify failed:', e?.message)
  }
}

/* ───────── approvalMode mapping (semantic <-> stored enum) ───────── */

function getEnumValues(model, pathName) {
  try {
    const path = model?.schema?.path?.(pathName)
    const enums = path?.enumValues
    return Array.isArray(enums) ? enums.map((x) => String(x)) : []
  } catch {
    return []
  }
}

// semantic modes we want UI to use
const SEMANTIC = Object.freeze(['MANAGER_AND_GM', 'GM_AND_COO'])

function normalizeApprovalModeSemantic(v) {
  const m = s(v).toUpperCase()

  // Backward-compat aliases:
  if (m === 'ADMIN_AND_GM') return 'MANAGER_AND_GM'
  if (m === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (m === 'GM_OR_COO') return 'GM_AND_COO'
  if (m === 'GM_AND_COO') return 'GM_AND_COO'
  if (m === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'

  return 'MANAGER_AND_GM'
}

function storedToSemantic(v) {
  const m = s(v).toUpperCase()
  if (m === 'GM_AND_COO' || m === 'GM_OR_COO' || m === 'GM_COO' || m === 'COO_AND_GM') return 'GM_AND_COO'
  return 'MANAGER_AND_GM'
}

/**
 * Convert semantic -> stored enum value for LeaveRequest.approvalMode
 * so Mongoose enum validation never fails.
 */
function semanticToStoredForRequest(semanticMode) {
  const sem = normalizeApprovalModeSemantic(semanticMode)
  const enums = getEnumValues(LeaveRequest, 'approvalMode')

  // No enum restriction => store semantic
  if (!enums.length) return sem

  // If schema already accepts semantic
  if (enums.includes(sem)) return sem

  // Map semantic to common legacy enums
  const map = {
    MANAGER_AND_GM: ['ADMIN_AND_GM', 'MANAGER_GM', 'MGR_AND_GM', 'GM_ONLY'],
    GM_AND_COO: ['GM_OR_COO', 'COO_AND_GM', 'GM_COO', 'GM_THEN_COO'],
  }

  for (const candidate of map[sem] || []) {
    if (enums.includes(candidate)) return candidate
  }

  // Fallback to first enum value if schema is strict and unknown
  return enums[0]
}

/**
 * Build a query matcher for "GM_AND_COO" across legacy stored values.
 */
function approvalModeQueryFor(semanticMode) {
  const sem = normalizeApprovalModeSemantic(semanticMode)
  const enums = getEnumValues(LeaveRequest, 'approvalMode')

  if (!enums.length) return sem // free schema

  // if schema accepts semantic directly
  if (enums.includes(sem)) return sem

  const legacy =
    sem === 'GM_AND_COO'
      ? ['GM_AND_COO', 'GM_OR_COO', 'GM_COO', 'COO_AND_GM', 'GM_THEN_COO']
      : ['MANAGER_AND_GM', 'ADMIN_AND_GM', 'MANAGER_GM', 'MGR_AND_GM', 'GM_ONLY']

  const allowed = legacy.filter((x) => enums.includes(x))
  if (allowed.length === 1) return allowed[0]
  if (allowed.length > 1) return { $in: allowed }

  // last resort: store mapping result
  return semanticToStoredForRequest(sem)
}

/* ───────── employee info join ───────── */

async function attachEmployeeInfo(docs = []) {
  const ids = [...new Set((docs || []).map((d) => s(d.employeeId)).filter(Boolean))]
  if (!ids.length) return docs

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [s(e.employeeId), e]))

  return (docs || []).map((d) => {
    const emp = map.get(s(d.employeeId))
    return {
      ...d,
      employeeName: emp?.name || d.employeeName || '',
      department: emp?.department || d.department || '',
      approvalMode: storedToSemantic(d.approvalMode), // ✅ always semantic for UI
    }
  })
}

async function attachEmployeeInfoToOne(doc) {
  if (!doc) return doc
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const employeeId = s(raw.employeeId)
  if (!employeeId) return { ...raw, approvalMode: storedToSemantic(raw.approvalMode) }

  const emp = await EmployeeDirectory.findOne({ employeeId }, { employeeId: 1, name: 1, department: 1 }).lean()

  return {
    ...raw,
    employeeName: emp?.name || raw.employeeName || '',
    department: emp?.department || raw.department || '',
    approvalMode: storedToSemantic(raw.approvalMode), // ✅ always semantic for UI
  }
}

/* ───────── balances helpers ───────── */

async function getApprovedRequests(employeeId) {
  return LeaveRequest.find({ employeeId, status: 'APPROVED' }).sort({ startDate: 1 }).lean()
}

function findBalanceRow(snapshot, code) {
  return (
    (snapshot?.balances || []).find(
      (b) => String(b.leaveTypeCode).toUpperCase() === String(code).toUpperCase()
    ) || null
  )
}

/* ───────── strict reserve + overlap ───────── */

const ACTIVE_STATUSES = ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED']

async function getActiveRequests(employeeId) {
  return LeaveRequest.find({
    employeeId: s(employeeId),
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ startDate: 1 })
    .lean()
}

async function hasOverlappingActiveRequest(employeeId, startYMD, endYMD) {
  const emp = s(employeeId)
  const s1 = s(startYMD)
  const e1 = s(endYMD)

  const hit = await LeaveRequest.findOne({
    employeeId: emp,
    status: { $in: ACTIVE_STATUSES },
    startDate: { $lte: e1 },
    endDate: { $gte: s1 },
  }).select({ _id: 1 })

  return !!hit
}

function computePendingUsage(pendingDocs = [], contractYearMeta) {
  const start = s(contractYearMeta?.startDate)
  const end = s(contractYearMeta?.endDate)

  const inContractYear = (d) => {
    const sd = s(d?.startDate)
    return start && end ? sd >= start && sd <= end : false
  }

  const sum = (code, docs) =>
    (docs || [])
      .filter((r) => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const pool = pendingDocs.filter(inContractYear)
  return {
    pendingAL: sum('AL', pool),
    pendingSP: sum('SP', pool),
    pendingMC: sum('MC', pool),
    pendingMA: sum('MA', pool),
  }
}

function normalizeDayPart(v) {
  const x = s(v).toUpperCase()
  if (!x) return null
  if (x === 'AM' || x === 'MORNING') return 'AM'
  if (x === 'PM' || x === 'AFTERNOON') return 'PM'
  return null
}

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

/* ───────── approval flow helpers ───────── */

function nextAfterManager() {
  return 'PENDING_GM'
}

function nextAfterGm(semanticMode) {
  return semanticMode === 'GM_AND_COO' ? 'PENDING_COO' : 'APPROVED'
}

function requireStatus(doc, allowed) {
  const cur = s(doc?.status)
  return allowed.includes(cur)
}

/* ───────────────── controllers ───────────────── */

/**
 * POST /leave/my/requests
 */
exports.createMyRequest = async (req, res, next) => {
  try {
    const {
      leaveTypeCode,
      startDate,
      endDate,
      reason = '',
      isHalfDay = false,   // legacy
      dayPart = null,      // legacy
      startHalf = null,    // NEW
      endHalf = null,      // NEW
    } = req.body || {}

    const requesterLoginId = actorLoginId(req)
    const employeeId = s(req.user?.employeeId || requesterLoginId)

    if (!requesterLoginId || !employeeId) {
      return res.status(400).json({ message: 'Missing requester identity' })
    }

    const lt = getLeaveType(leaveTypeCode)
    if (!lt) return res.status(400).json({ message: 'Invalid leave type' })

    const profile = await LeaveProfile.findOne({ employeeId, isActive: true }).lean()
    if (!profile) {
      return res.status(400).json({
        message: 'Leave profile is not configured for this employee. Please contact HR/admin.',
      })
    }

    // profile.approvalMode may be legacy; normalize to semantic first
    const semanticMode = normalizeApprovalModeSemantic(profile.approvalMode)

    // ✅ store approvalMode using LeaveRequest schema's enum
    const storedMode = semanticToStoredForRequest(semanticMode)

    const managerLoginId = s(profile.managerLoginId || profile.managerEmployeeId)
    const gmLoginId = s(profile.gmLoginId)
    const cooLoginId = s(profile.cooLoginId)

    if (!gmLoginId) {
      return res.status(400).json({
        message: 'GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }
    if (semanticMode === 'GM_AND_COO' && !cooLoginId) {
      return res.status(400).json({
        message: 'COO approver mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    const vr = validateAndNormalizeRequest({
      leaveTypeCode: lt.code,
      startDate,
      endDate,
      isHalfDay: !!isHalfDay,
      dayPart,
      startHalf,
      endHalf,
    })

    if (!vr.ok) return res.status(400).json({ message: vr.message })

    const normalized = vr.normalized
    const requestedDays = Number(normalized.totalDays || 0)

    const overlap = await hasOverlappingActiveRequest(employeeId, normalized.startDate, normalized.endDate)
    if (overlap) {
      return res.status(400).json({
        message: 'You already have a leave request submitted/approved that overlaps these dates.',
      })
    }

    // strict remaining (including pending reservation)
    const approved = await getApprovedRequests(employeeId)
    const snapshot = computeBalances(profile, approved, new Date())

    const active = await getActiveRequests(employeeId)
    const pending = active.filter((r) => ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(r.status))
    const pend = computePendingUsage(pending, snapshot?.meta?.contractYear)

    const remaining = (code) => Number(findBalanceRow(snapshot, code)?.remaining ?? 0)
    const code = String(lt.code || '').toUpperCase()

    // ✅ NEW RULE:
    // - AL remaining already includes SP usage in balances
    // - Reserve AL against pending AL + pending SP (because SP consumes AL)
    if (code === 'AL') {
      const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)
      if (strictAL <= 0) {
        return res.status(400).json({
          message:
            'AL remaining is already reserved by your pending requests (including SP). Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strictAL) {
        return res.status(400).json({
          message: `Insufficient AL (including pending SP). Remaining ${strictAL}, requested ${requestedDays}.`,
        })
      }
    }

    // ✅ NEW RULE for SP:
    // - SP is allowed (quota 7), BUT it always deducts from AL
    // - NO borrowing: AL must be enough to cover SP days
    // - If AL=0 => SP not allowed
    if (code === 'SP') {
      const strictSP = remaining('SP') - pend.pendingSP
      if (strictSP <= 0) {
        return res.status(400).json({
          message:
            'SP remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strictSP) {
        return res.status(400).json({
          message: `SP exceeds remaining (including pending). Remaining ${strictSP}, requested ${requestedDays}.`,
        })
      }

      // SP consumes AL too (include pending reservations)
      const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)

      if (strictAL <= 0) {
        return res.status(400).json({
          message:
            'You cannot use SP because your AL remaining is 0 (or fully reserved by pending requests).',
        })
      }

      if (requestedDays > strictAL) {
        return res.status(400).json({
          message: `You cannot use SP because AL remaining is insufficient. Remaining AL ${strictAL}, requested SP ${requestedDays}.`,
        })
      }

      // ✅ Do NOT block SP even when AL is enough.
      // SP is allowed, but will reduce AL.
    }

    if (code === 'MC') {
      const strict = remaining('MC') - pend.pendingMC
      if (strict <= 0) {
        return res.status(400).json({
          message:
            'MC remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strict) {
        return res.status(400).json({
          message: `Insufficient MC (including pending). Remaining ${strict}, requested ${requestedDays}.`,
        })
      }
    }

    if (code === 'MA') {
      const strict = remaining('MA') - pend.pendingMA
      if (strict <= 0) {
        return res.status(400).json({
          message:
            'MA remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strict) {
        return res.status(400).json({
          message: `Insufficient MA (including pending). Remaining ${strict}, requested ${requestedDays}.`,
        })
      }
    }

    // initial status: manager exists -> PENDING_MANAGER else -> PENDING_GM
    const initialStatus = managerLoginId ? 'PENDING_MANAGER' : 'PENDING_GM'

    const createPayload = {
      employeeId,
      requesterLoginId,
      leaveTypeCode: code,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      totalDays: requestedDays,
      reason: String(reason || ''),
      status: initialStatus,

      managerLoginId: managerLoginId || '',
      gmLoginId,
      cooLoginId: semanticMode === 'GM_AND_COO' ? cooLoginId : '',

      // ✅ store enum-safe mode
      approvalMode: storedMode,

      // legacy safety
      adminLoginId: '',
    }

    // ✅ Always save edge halves (multi-day support)
    createPayload.startHalf = normalized.startHalf || null
    createPayload.endHalf = normalized.endHalf || null

    // ✅ Always keep legacy fields consistent
    createPayload.isHalfDay = !!normalized.isHalfDay
    createPayload.dayPart = normalized.dayPart || null


    const doc = await LeaveRequest.create(createPayload)

    if (DEBUG) {
      console.log('[leave] createMyRequest ->', {
        employeeId,
        managerLoginId,
        gmLoginId,
        cooLoginId,
        semanticMode,
        storedMode,
        status: initialStatus,
        id: doc._id.toString(),
      })
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // Telegram notify the correct next approver
    if (initialStatus === 'PENDING_MANAGER') {
      await safeNotify(notify.notifyNewLeaveToManager, doc)
    } else {
      await safeNotify(notify.notifyNewLeaveToGm, doc)
    }

    emitReq(req, payload, 'leave:req:created')
    return res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listMyRequests = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    const employeeId = s(req.user?.employeeId || me)
    if (!employeeId) return res.status(400).json({ message: 'Missing user identity' })

    const docs = await LeaveRequest.find({ employeeId }).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.cancelMyRequest = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const { id } = req.params
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (s(doc.requesterLoginId) !== loginId && !isAdminViewer(req)) {
      return res.status(403).json({ message: 'Not your request' })
    }

    // ❌ Once manager has approved, user cannot cancel
    if (s(doc.status) !== 'PENDING_MANAGER') {
      return res.status(400).json({
        message: 'You can only cancel a leave request before it is approved by your manager.',
      })
    }


    doc.status = 'CANCELLED'
    doc.cancelledAt = new Date()
    doc.cancelledBy = loginId

    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)

    emitReq(req, payload, 'leave:req:updated')
    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /leave/manager/inbox
 */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const adminViewer = isAdminViewer(req)
    const criteria = adminViewer ? {} : { managerLoginId: loginId }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

/**
 * POST /leave/manager/decision/:id
 */
exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const current = await LeaveRequest.findById(id)
    if (!current) return res.status(404).json({ message: 'Request not found' })

    const adminViewer = isAdminViewer(req)
    if (!adminViewer && s(current.managerLoginId) !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }
    if (s(current.status) !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    const act = s(action).toUpperCase()
    const semanticMode = storedToSemantic(current.approvalMode)

    let nextStatus = ''
    if (act === 'APPROVE') nextStatus = nextAfterManager(semanticMode)
    else if (act === 'REJECT') nextStatus = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_MANAGER' },
      {
        $set: {
          status: nextStatus,
          managerComment: String(comment || ''),
          managerDecisionAt: new Date(),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await LeaveRequest.findById(id).lean()
      return res.status(409).json({
        message: `Someone already handled this request (${latest?.status || 'UNKNOWN'}).`,
      })
    }

    await safeNotify(notify.notifyManagerDecision, doc)

    if (doc.status === 'PENDING_GM') {
      await safeNotify(notify.notifyNewLeaveToGm, doc)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    if (doc.status === 'REJECTED') {
      await recalcAndEmitProfile(req, doc.employeeId)
    }

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /leave/gm/inbox
 */
exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const adminViewer = isAdminViewer(req)

    const criteria = adminViewer
      ? { status: { $in: ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] } }
      : {
          gmLoginId: loginId,
          status: { $in: ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] },
        }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

/**
 * POST /leave/gm/decision/:id
 */
exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const current = await LeaveRequest.findById(id)
    if (!current) return res.status(404).json({ message: 'Request not found' })

    const adminViewer = isAdminViewer(req)
    if (!adminViewer && s(current.gmLoginId) !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (!requireStatus(current, ['PENDING_GM'])) {
      return res.status(400).json({
        message: `Request is ${current.status}. GM cannot decide at this stage.`,
      })
    }

    const act = s(action).toUpperCase()
    const semanticMode = storedToSemantic(current.approvalMode)

    let newStatus = ''
    if (act === 'APPROVE') newStatus = nextAfterGm(semanticMode)
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_GM' },
      {
        $set: {
          status: newStatus,
          gmComment: String(comment || ''),
          gmDecisionAt: new Date(),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await LeaveRequest.findById(id).lean()
      return res.status(409).json({
        message: `Someone already handled this request (${latest?.status || 'UNKNOWN'}).`,
      })
    }

    await safeNotify(notify.notifyGmDecision, doc)

    if (doc.status === 'PENDING_COO') {
      await safeNotify(notify.notifyNewLeaveToCoo, doc)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    if (doc.status === 'APPROVED' || doc.status === 'REJECTED') {
      await recalcAndEmitProfile(req, doc.employeeId)
    }

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

/* Export helpers if you use them elsewhere */
exports.isAdminViewer = isAdminViewer
exports.getRoles = getRoles
