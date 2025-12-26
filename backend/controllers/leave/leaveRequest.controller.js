/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { getLeaveType } = require('../../config/leaveSystemTypes')
const {
  validateAndNormalizeRequest,
  computeBalances,
} = require('../../utils/leave.rules')

const {
  notifyNewLeaveToManager,
  notifyManagerDecision,
  notifyNewLeaveToGm,
  notifyGmDecision,
} = require('../../services/leave/leave.telegram.notify')

const { broadcastLeaveRequest } = require('../../utils/realtime')

const DEBUG =
  String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

/* ───────────────── helpers ───────────────── */

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function actorLoginId(req) {
  // JWT signToken uses { id: user.loginId }
  return String(req.user?.id || req.user?.loginId || req.user?.sub || '').trim()
}

function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map(r => String(r || '').toUpperCase()))]
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
}

async function attachEmployeeInfo(docs = []) {
  const ids = [...new Set(
    (docs || [])
      .map(d => String(d.employeeId || '').trim())
      .filter(Boolean)
  )]
  if (!ids.length) return docs

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

async function getApprovedRequests(employeeId) {
  return LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()
}

function findBalanceRow(snapshot, code) {
  return (
    (snapshot?.balances || []).find(
      b => String(b.leaveTypeCode).toUpperCase() === String(code).toUpperCase()
    ) || null
  )
}

/* ───────── strict reserve + overlap ───────── */

const ACTIVE_STATUSES = ['PENDING_MANAGER', 'PENDING_GM', 'APPROVED']

async function getActiveRequests(employeeId) {
  return LeaveRequest.find({
    employeeId: String(employeeId || '').trim(),
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ startDate: 1 })
    .lean()
}

// Overlap if startA <= endB && endA >= startB (YMD strings can compare)
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
 * - SP/MC/MA are contract-year based
 * - SP also reserves AL because SP borrows from AL
 */
function computePendingUsage(pendingDocs = [], contractYearMeta) {
  const start = String(contractYearMeta?.startDate || '')
  const end   = String(contractYearMeta?.endDate || '')

  const inContractYear = (d) => {
    const s = String(d?.startDate || '')
    return start && end ? (s >= start && s <= end) : false
  }

  const sum = (code, docs) =>
    (docs || [])
      .filter(r => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const pendingAL = sum('AL', pendingDocs.filter(inContractYear))
  const pendingSP = sum('SP', pendingDocs.filter(inContractYear))
  const pendingMC = sum('MC', pendingDocs.filter(inContractYear))
  const pendingMA = sum('MA', pendingDocs.filter(inContractYear))

  return { pendingAL, pendingSP, pendingMC, pendingMA }
}

/* normalize half-day inputs -> AM/PM (only set when valid) */
function normalizeDayPart(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return null
  if (s === 'AM' || s === 'MORNING') return 'AM'
  if (s === 'PM' || s === 'AFTERNOON') return 'PM'
  return null
}

/* ───────────────── controllers ───────────────── */

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

    // ✅ GM must exist, manager can be optional (GM-only flow)
    if (!gmLoginId) {
      return res.status(400).json({
        message: 'GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    const normalizedDayPart = isHalfDay ? normalizeDayPart(dayPart) : null
    if (isHalfDay && !normalizedDayPart) {
      return res.status(400).json({ message: 'Half-day requires dayPart = AM/PM (Morning/Afternoon).' })
    }

    // ✅ normalize dates + working days + MA fixed + half-day
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

    // ✅ block overlap (submitted/approved)
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

    // ✅ balances snapshot from APPROVED
    const approved = await getApprovedRequests(employeeId)
    const snapshot = computeBalances(profile, approved, new Date())

    // ✅ reserve pending so cannot spam beyond remaining
    const active = await getActiveRequests(employeeId)
    const pending = active.filter(r => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_GM')
    const pend = computePendingUsage(pending, snapshot?.meta?.contractYear)

    const remaining = (code) => Number(findBalanceRow(snapshot, code)?.remaining ?? 0)

    const code = String(lt.code || '').toUpperCase()

    // ✅ Strict remaining rules (including pending reservations)
    if (code === 'AL') {
      const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)
      if (strictAL <= 0) {
        return res.status(400).json({
          message: 'AL remaining is already reserved by your pending requests (including SP). Wait for decision or cancel pending request.',
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

    // UL unlimited -> no strict check

    // ✅ if manager missing => go directly to GM
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
        status: initialStatus,
        id: doc._id.toString(),
      })
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // notify correct approver
    if (initialStatus === 'PENDING_MANAGER') {
      try { await notifyNewLeaveToManager(doc) } catch (e) {
        console.warn('⚠️ notifyNewLeaveToManager failed:', e?.message)
      }
    } else {
      try { await notifyNewLeaveToGm(doc) } catch (e) {
        console.warn('⚠️ notifyNewLeaveToGm failed:', e?.message)
      }
    }

    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:created')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ leave:req:created emit failed:', e?.message)
    }

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

    const docs = await LeaveRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

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

    if (!['PENDING_MANAGER', 'PENDING_GM'].includes(doc.status)) {
      return res.status(400).json({ message: 'Cannot cancel at this stage' })
    }

    doc.status = 'CANCELLED'
    doc.cancelledAt = new Date()
    doc.cancelledBy = loginId

    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    try {
      const io = getIo(req)
      if (io) broadcastLeaveRequest(io, payload, 'leave:req:updated')
    } catch (e) {
      console.warn('⚠️ leave:req:cancel emit failed:', e?.message)
    }

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const criteria = isAdminViewer(req) ? {} : { managerLoginId: loginId }

    const docs = await LeaveRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    const admin = isAdminViewer(req)
    if (!admin && String(doc.managerLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }
    if (doc.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    const act = String(action || '').toUpperCase()
    if (act === 'APPROVE') doc.status = 'PENDING_GM'
    else if (act === 'REJECT') doc.status = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    doc.managerComment = String(comment || '')
    doc.managerDecisionAt = new Date()

    await doc.save()

    try { await notifyManagerDecision(doc) } catch (e) {
      console.warn('⚠️ notifyManagerDecision failed:', e?.message)
    }

    if (doc.status === 'PENDING_GM') {
      try { await notifyNewLeaveToGm(doc) } catch (e) {
        console.warn('⚠️ notifyNewLeaveToGm failed:', e?.message)
      }
    }

    const payload = await attachEmployeeInfoToOne(doc)
    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:manager-decision')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ manager decision emit failed:', e?.message)
    }

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const criteria = isAdminViewer(req) ? {} : { gmLoginId: loginId }

    const docs = await LeaveRequest.find(criteria)
      .sort({ createdAt: -1 })
      .lean()

    return res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    const admin = isAdminViewer(req)
    if (!admin && String(doc.gmLoginId || '') !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }
    if (doc.status !== 'PENDING_GM') {
      return res.status(400).json({ message: 'Request not in GM queue' })
    }

    const act = String(action || '').toUpperCase()

    if (act === 'APPROVE') {
      // ✅ race-safe strict re-check (including pending reservations)
      const profile = await LeaveProfile.findOne({ employeeId: doc.employeeId, isActive: true }).lean()
      if (!profile) return res.status(400).json({ message: 'Leave profile missing' })

      const approved = await getApprovedRequests(doc.employeeId)
      const snapshot = computeBalances(profile, approved, new Date())

      const active = await getActiveRequests(doc.employeeId)
      const pendingOthers = active.filter(r =>
        (r.status === 'PENDING_MANAGER' || r.status === 'PENDING_GM') &&
        String(r._id) !== String(doc._id)
      )
      const pend = computePendingUsage(pendingOthers, snapshot?.meta?.contractYear)

      const remaining = (c) => Number(findBalanceRow(snapshot, c)?.remaining ?? 0)

      const code = String(doc.leaveTypeCode || '').toUpperCase()
      const days = Number(doc.totalDays || 0)

      if (code === 'SP') {
        const strictSP = remaining('SP') - pend.pendingSP
        if (days > strictSP) {
          return res.status(400).json({ message: 'SP remaining changed (including pending). Please refresh.' })
        }

        const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)
        if (strictAL >= days) {
          return res.status(400).json({
            message: 'SP is only allowed when AL is insufficient. AL is now sufficient—please refresh.',
          })
        }
      }

      if (code === 'AL') {
        const strictAL = remaining('AL') - (pend.pendingAL + pend.pendingSP)
        if (days > strictAL) {
          return res.status(400).json({ message: 'AL remaining changed (including pending SP). Please refresh.' })
        }
      }

      if (code === 'MC') {
        const strict = remaining('MC') - pend.pendingMC
        if (days > strict) return res.status(400).json({ message: 'MC remaining changed (including pending). Please refresh.' })
      }

      if (code === 'MA') {
        const strict = remaining('MA') - pend.pendingMA
        if (days > strict) return res.status(400).json({ message: 'MA remaining changed (including pending). Please refresh.' })
      }

      doc.status = 'APPROVED'
    } else if (act === 'REJECT') {
      doc.status = 'REJECTED'
    } else {
      return res.status(400).json({ message: 'Invalid action' })
    }

    doc.gmComment = String(comment || '')
    doc.gmDecisionAt = new Date()

    await doc.save()

    try { await notifyGmDecision(doc) } catch (e) {
      console.warn('⚠️ notifyGmDecision failed:', e?.message)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    try {
      const io = getIo(req)
      if (io) {
        broadcastLeaveRequest(io, payload, 'leave:req:gm-decision')
        broadcastLeaveRequest(io, payload, 'leave:req:updated')
      }
    } catch (e) {
      console.warn('⚠️ gm decision emit failed:', e?.message)
    }

    return res.json(payload)
  } catch (err) {
    next(err)
  }
}
