/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { getLeaveType } = require('../../config/leaveSystemTypes')
const { validateAndNormalizeRequest, computeBalances } = require('../../utils/leave.rules')

const notify = require('../../services/leave/leave.telegram.notify')

// ✅ FIX: use leave realtime broadcaster (NOT utils/realtime.js)
const { broadcastLeaveRequest, broadcastLeaveProfile } = require('../../utils/leave.realtime')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

/* ───────────────── helpers ───────────────── */

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

/**
 * ✅ IMPORTANT: prefer loginId first (your LeaveRequest stores loginId strings)
 * (req.user.id might be Mongo _id and break matching)
 */
function actorLoginId(req) {
  return String(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '').trim()
}

function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map((r) => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

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

async function attachEmployeeInfo(docs = []) {
  const ids = [
    ...new Set(
      (docs || [])
        .map((d) => String(d.employeeId || '').trim())
        .filter(Boolean)
    ),
  ]
  if (!ids.length) return docs

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [String(e.employeeId || '').trim(), e]))

  return (docs || []).map((d) => {
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

/**
 * ✅ include PENDING_COO for backward compatibility
 * but final stage should be shared in PENDING_GM.
 */
const ACTIVE_STATUSES = ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED']

async function getActiveRequests(employeeId) {
  return LeaveRequest.find({
    employeeId: String(employeeId || '').trim(),
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ startDate: 1 })
    .lean()
}

// Overlap if startA <= endB && endA >= startB
async function hasOverlappingActiveRequest(employeeId, startYMD, endYMD) {
  const emp = String(employeeId || '').trim()
  const s = String(startYMD || '').trim()
  const e = String(endYMD || '').trim()

  const hit = await LeaveRequest.findOne({
    employeeId: emp,
    status: { $in: ACTIVE_STATUSES },
    startDate: { $lte: e },
    endDate: { $gte: s },
  }).select({ _id: 1 })

  return !!hit
}

/**
 * Reserve pending usage so user cannot spam requests beyond remaining.
 * ✅ Uses contract-year window (snapshot.meta.contractYear)
 */
function computePendingUsage(pendingDocs = [], contractYearMeta) {
  const start = String(contractYearMeta?.startDate || '')
  const end = String(contractYearMeta?.endDate || '')

  const inContractYear = (d) => {
    const s = String(d?.startDate || '')
    return start && end ? s >= start && s <= end : false
  }

  const sum = (code, docs) =>
    (docs || [])
      .filter((r) => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const pool = pendingDocs.filter(inContractYear)
  const pendingAL = sum('AL', pool)
  const pendingSP = sum('SP', pool)
  const pendingMC = sum('MC', pool)
  const pendingMA = sum('MA', pool)

  return { pendingAL, pendingSP, pendingMC, pendingMA }
}

function normalizeDayPart(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return null
  if (s === 'AM' || s === 'MORNING') return 'AM'
  if (s === 'PM' || s === 'AFTERNOON') return 'PM'
  return null
}

/**
 * ✅ IMPORTANT:
 * Recalculate balances in DB and broadcast profile update so UI refreshes.
 * Called when request becomes APPROVED / CANCELLED / REJECTED.
 */
async function recalcAndEmitProfile(req, employeeId) {
  try {
    const empId = String(employeeId || '').trim()
    if (!empId) return

    const prof = await LeaveProfile.findOne({ employeeId: empId })
    if (!prof) return

    const approved = await LeaveRequest.find({ employeeId: empId, status: 'APPROVED' })
      .sort({ startDate: 1 })
      .lean()

    const snap = computeBalances(prof.toObject ? prof.toObject() : prof, approved, new Date())

    const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
    const nextAsOf = String(snap?.meta?.asOfYMD || prof.balancesAsOf || '').trim()
    const nextEnd = snap?.meta?.contractYear?.endDate
      ? String(snap.meta.contractYear.endDate)
      : String(prof.contractEndDate || '')

    const before = JSON.stringify(prof.balances || [])
    const after = JSON.stringify(nextBalances)

    let changed = false
    if (before !== after) {
      prof.balances = nextBalances
      changed = true
    }
    if (nextAsOf && String(prof.balancesAsOf || '') !== nextAsOf) {
      prof.balancesAsOf = nextAsOf
      changed = true
    }
    if (nextEnd && String(prof.contractEndDate || '') !== nextEnd) {
      prof.contractEndDate = nextEnd
      changed = true
    }

    if (changed) await prof.save()
    emitProfile(req, prof, 'leave:profile:updated')
  } catch (e) {
    console.warn('⚠️ recalcAndEmitProfile failed:', e?.message)
  }
}

/* ───────────────── controllers ───────────────── */

/**
 * POST /leave/my/requests
 * Employee creates request
 */
exports.createMyRequest = async (req, res, next) => {
  try {
    const {
      leaveTypeCode,
      startDate,
      endDate,
      reason = '',
      isHalfDay = false,
      dayPart = null,
    } = req.body || {}

    const requesterLoginId = actorLoginId(req)
    const employeeId = String(req.user?.employeeId || requesterLoginId).trim()

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

    const managerLoginId = String(profile.managerLoginId || '').trim()
    const gmLoginId = String(profile.gmLoginId || '').trim()
    const cooLoginId = String(profile.cooLoginId || '').trim() // ✅ optional

    if (!gmLoginId) {
      return res.status(400).json({
        message: 'GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    const normalizedDayPart = isHalfDay ? normalizeDayPart(dayPart) : null
    if (isHalfDay && !normalizedDayPart) {
      return res.status(400).json({
        message: 'Half-day requires dayPart = AM/PM (Morning/Afternoon).',
      })
    }

    const vr = validateAndNormalizeRequest({
      leaveTypeCode: lt.code,
      startDate,
      endDate,
      isHalfDay: !!isHalfDay,
      dayPart: normalizedDayPart,
    })
    if (!vr.ok) return res.status(400).json({ message: vr.message })

    const normalized = vr.normalized
    const requestedDays = Number(normalized.totalDays || 0)

    const overlap = await hasOverlappingActiveRequest(
      employeeId,
      normalized.startDate,
      normalized.endDate
    )
    if (overlap) {
      return res.status(400).json({
        message: 'You already have a leave request submitted/approved that overlaps these dates.',
      })
    }

    const approved = await getApprovedRequests(employeeId)
    const snapshot = computeBalances(profile, approved, new Date())

    const active = await getActiveRequests(employeeId)
    const pending = active.filter(
      (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_GM' || r.status === 'PENDING_COO'
    )
    const pend = computePendingUsage(pending, snapshot?.meta?.contractYear)

    const remaining = (code) => Number(findBalanceRow(snapshot, code)?.remaining ?? 0)
    const code = String(lt.code || '').toUpperCase()

    // ✅ Strict remaining rules (including pending reservations)
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

    if (code === 'SP') {
      const strictSP = remaining('SP') - pend.pendingSP
      if (strictSP <= 0) {
        return res.status(400).json({
          message: 'SP remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strictSP) {
        return res.status(400).json({
          message: `SP exceeds remaining (including pending). Remaining ${strictSP}, requested ${requestedDays}.`,
        })
      }

      const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)
      if (strictAL >= requestedDays) {
        return res.status(400).json({
          message: `You still have enough AL (${strictAL}) for ${requestedDays} days. Please use AL. SP is only for borrowing when AL is insufficient.`,
        })
      }
    }

    if (code === 'MC') {
      const strict = remaining('MC') - pend.pendingMC
      if (strict <= 0) {
        return res.status(400).json({
          message: 'MC remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
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
          message: 'MA remaining is already reserved by your pending requests. Wait for decision or cancel pending request.',
        })
      }
      if (requestedDays > strict) {
        return res.status(400).json({
          message: `Insufficient MA (including pending). Remaining ${strict}, requested ${requestedDays}.`,
        })
      }
    }

    const initialStatus = managerLoginId ? 'PENDING_MANAGER' : 'PENDING_GM'

    /**
     * ✅ IMPORTANT:
     * Use enum values your MODEL accepts:
     * - 'GM_ONLY'
     * - 'GM_OR_COO'
     *
     * This is the shared final queue mode.
     */
    const approvalMode = cooLoginId ? 'GM_OR_COO' : 'GM_ONLY'

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
      cooLoginId,

      approvalMode,
    }

    if (normalized.isHalfDay) {
      createPayload.isHalfDay = true
      createPayload.dayPart = normalized.dayPart // 'AM' | 'PM'
    }

    const doc = await LeaveRequest.create(createPayload)

    if (DEBUG) {
      console.log('[leave] createMyRequest ->', {
        employeeId,
        managerLoginId,
        gmLoginId,
        cooLoginId,
        approvalMode,
        status: initialStatus,
        id: doc._id.toString(),
      })
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // ✅ Telegram: notify correct approver(s)
    if (initialStatus === 'PENDING_MANAGER') {
      await safeNotify(notify.notifyNewLeaveToManager || notify.notifyNewLeaveToManager, doc)
    } else {
      // final stage starts here (no manager)
      await safeNotify(notify.notifyNewLeaveToGm || notify.notifyNewLeaveToGm, doc)
      if (approvalMode === 'GM_OR_COO') {
        await safeNotify(notify.notifyNewLeaveToCoo || notify.notifyNewLeaveToCoo, doc)
      }
    }

    // ✅ REALTIME
    emitReq(req, payload, 'leave:req:created')

    return res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listMyRequests = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    const employeeId = String(req.user?.employeeId || me).trim()
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

    if (String(doc.requesterLoginId || '') !== loginId && !isAdminViewer(req)) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (!['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(String(doc.status || ''))) {
      return res.status(400).json({ message: 'Cannot cancel at this stage' })
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
 * GET /leave/manager/inbox?tab=PENDING|FINISHED
 */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const admin = isAdminViewer(req)

    // ✅ Return ALL statuses for this manager; UI tabs will filter
    const criteria = admin ? {} : { managerLoginId: loginId }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}


/**
 * POST /leave/manager/decision/:id
 * body { action: APPROVE|REJECT, comment? }
 */
exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const current = await LeaveRequest.findById(id)
    if (!current) return res.status(404).json({ message: 'Request not found' })

    const admin = isAdminViewer(req)
    if (!admin && String(current.managerLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }
    if (String(current.status || '') !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    const act = String(action || '').toUpperCase()
    let nextStatus = ''
    if (act === 'APPROVE') nextStatus = 'PENDING_GM'
    else if (act === 'REJECT') nextStatus = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    // ✅ atomic lock: only update if still PENDING_MANAGER
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

    await safeNotify(notify.notifyManagerDecision || notify.notifyManagerDecision, doc)

    // After manager approve → final approver stage (GM + maybe COO)
    if (doc.status === 'PENDING_GM') {
      await safeNotify(notify.notifyNewLeaveToGm || notify.notifyNewLeaveToGm, doc)

      const mode = String(doc.approvalMode || '').toUpperCase()
      const isShared = mode === 'GM_OR_COO' || mode === 'GM_OR_COO' // tolerate old mode strings
      if (isShared) {
        await safeNotify(notify.notifyNewLeaveToCoo || notify.notifyNewLeaveToCoo, doc)
      }
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
 * GET /leave/gm/inbox?tab=PENDING|FINISHED
 * ✅ GM inbox should show only final stage items by default
 */
exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const admin = isAdminViewer(req)

    // ✅ return ALL statuses for this GM (UI will filter Pending/Finished)
    const criteria = admin ? {} : { gmLoginId: loginId }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}


/**
 * POST /leave/gm/decision/:id
 * body { action: APPROVE|REJECT, comment? }
 *
 * ✅ GM + COO shared final:
 * - only update if status is still pending
 * - if COO already decided -> status is APPROVED/REJECTED -> GM cannot change
 */
exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const current = await LeaveRequest.findById(id)
    if (!current) return res.status(404).json({ message: 'Request not found' })

    const admin = isAdminViewer(req)
    if (!admin && String(current.gmLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    // ✅ if already decided by COO first (or anyone), GM cannot change
    if (!['PENDING_GM', 'PENDING_COO'].includes(String(current.status || ''))) {
      return res.status(400).json({
        message: `Request already ${current.status}. You cannot change it.`,
      })
    }

    const act = String(action || '').toUpperCase()
    let newStatus = ''
    if (act === 'APPROVE') newStatus = 'APPROVED'
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    // ✅ race-safe update: only update if still pending
    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: { $in: ['PENDING_GM', 'PENDING_COO'] } },
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
        message: `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`,
      })
    }

    await safeNotify(notify.notifyGmDecision || notify.notifyGmDecision, doc)

    const payload = await attachEmployeeInfoToOne(doc)
    emitReq(req, payload, 'leave:req:updated')

    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

/* Export helpers for routes/middleware if needed */
exports.isAdminViewer = isAdminViewer
exports.getRoles = getRoles
