/* eslint-disable no-console */
// backend/controllers/leave/leaveRequest.controller.js

const LeaveRequest  = require('../../models/leave/LeaveRequest')
const LeaveProfile  = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { getLeaveType } = require('../../config/leaveSystemTypes')
const { validateAndNormalizeRequest, computeBalances } = require('../../utils/leave.rules')

const {
  notifyNewLeaveToManager,
  notifyManagerDecision,
  notifyNewLeaveToGm,
  notifyGmDecision,
} = require('../../services/leave/leave.telegram.notify')

const { broadcastLeaveRequest } = require('../../utils/realtime')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'

function getIo(req) {
  return req.io || req.app?.get('io') || null
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
  return (snapshot?.balances || []).find(b => String(b.leaveTypeCode).toUpperCase() === code) || null
}

exports.createMyRequest = async (req, res, next) => {
  try {
    const { leaveTypeCode, startDate, endDate, reason = '' } = req.body || {}

    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()

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
    const gmLoginId      = String(profile.gmLoginId || '').trim()
    if (!managerLoginId || !gmLoginId) {
      return res.status(400).json({
        message: 'Manager/GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    // Normalize dates + compute totalDays (working days) and enforce MA fixed 90 days
    const vr = validateAndNormalizeRequest({
      leaveTypeCode: lt.code,
      startDate,
      endDate,
    })
    if (!vr.ok) return res.status(400).json({ message: vr.message })

    const normalized = vr.normalized
    const requestedDays = Number(normalized.totalDays || 0)

    // Snapshot balances (APPROVED history)
    const approved = await getApprovedRequests(employeeId)
    const snapshot = computeBalances(profile, approved, new Date())

    // Enforce rules by type
    if (lt.code === 'SP') {
      const sp = findBalanceRow(snapshot, 'SP')
      const rem = Number(sp?.remaining ?? 0)
      if (rem <= 0) {
        return res.status(400).json({
          message: 'SP balance is 0. Wait until 1 year from join date to renew.',
        })
      }
      if (requestedDays > rem) {
        return res.status(400).json({
          message: `SP exceeds remaining. Remaining ${rem}, requested ${requestedDays}`,
        })
      }
      // SP can borrow from AL (AL may become negative) => allowed
    }

    if (lt.code === 'AL') {
      const al = findBalanceRow(snapshot, 'AL')
      const rem = Number(al?.remaining ?? 0)
      // AL itself must NOT go more negative (only SP can borrow)
      if (requestedDays > rem) {
        return res.status(400).json({
          message: `Insufficient AL. Remaining ${rem}, requested ${requestedDays}. Use SP if eligible.`,
        })
      }
    }

    if (lt.code === 'MC') {
      const mc = findBalanceRow(snapshot, 'MC')
      const rem = Number(mc?.remaining ?? 0)
      if (requestedDays > rem) {
        return res.status(400).json({
          message: `Insufficient MC. Remaining ${rem}, requested ${requestedDays}`,
        })
      }
    }

    // MA already forced to 90 fixed
    // UL unlimited

    const doc = await LeaveRequest.create({
      employeeId,
      requesterLoginId,
      leaveTypeCode: lt.code,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      totalDays: requestedDays,
      reason: String(reason || ''),
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

    const payload = await attachEmployeeInfoToOne(doc)

    try { await notifyNewLeaveToManager(doc) } catch (e) {
      console.warn('⚠️ notifyNewLeaveToManager failed:', e?.message)
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

    res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listMyRequests = async (req, res, next) => {
  try {
    const requesterLoginId = String(req.user?.id || '').trim()
    const employeeId       = String(req.user?.employeeId || requesterLoginId).trim()
    if (!employeeId) return res.status(400).json({ message: 'Missing user identity' })

    const docs = await LeaveRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.cancelMyRequest = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    const { id }  = req.params
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (String(doc.requesterLoginId || '') !== loginId) {
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

    res.json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
    const baseRole = req.user?.role ? [req.user.role] : []
    const roles    = [...new Set([...rawRoles, ...baseRole].map(r => String(r).toUpperCase()))]

    const isAdminViewer = roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
    const criteria = isAdminViewer ? {} : { managerLoginId: loginId }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

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

    if (action === 'APPROVE') doc.status = 'PENDING_GM'
    else if (action === 'REJECT') doc.status = 'REJECTED'
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

    res.json(payload)
  } catch (err) {
    next(err)
  }
}

exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

    const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
    const baseRole = req.user?.role ? [req.user.role] : []
    const roles    = [...new Set([...rawRoles, ...baseRole].map(r => String(r).toUpperCase()))]

    const isAdminViewer = roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
    const criteria = isAdminViewer ? {} : { gmLoginId: loginId }

    const docs = await LeaveRequest.find(criteria).sort({ createdAt: -1 }).lean()
    res.json(await attachEmployeeInfo(docs))
  } catch (err) {
    next(err)
  }
}

exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) return res.status(400).json({ message: 'Missing user identity' })

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

    // ✅ Before final approve, re-check rules (avoid race conditions)
    if (action === 'APPROVE') {
      const profile = await LeaveProfile.findOne({ employeeId: doc.employeeId, isActive: true }).lean()
      if (!profile) return res.status(400).json({ message: 'Leave profile missing' })

      const approved = await getApprovedRequests(doc.employeeId)
      const snapshot = computeBalances(profile, approved, new Date())

      const code = String(doc.leaveTypeCode || '').toUpperCase()
      const days = Number(doc.totalDays || 0)

      if (code === 'SP') {
        const sp = findBalanceRow(snapshot, 'SP')
        if (days > Number(sp?.remaining ?? 0)) {
          return res.status(400).json({ message: 'SP remaining changed. Please refresh.' })
        }
      }
      if (code === 'AL') {
        const al = findBalanceRow(snapshot, 'AL')
        if (days > Number(al?.remaining ?? 0)) {
          return res.status(400).json({ message: 'AL remaining changed. Please refresh.' })
        }
      }
      if (code === 'MC') {
        const mc = findBalanceRow(snapshot, 'MC')
        if (days > Number(mc?.remaining ?? 0)) {
          return res.status(400).json({ message: 'MC remaining changed. Please refresh.' })
        }
      }

      doc.status = 'APPROVED'
    } else if (action === 'REJECT') {
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

    res.json(payload)
  } catch (err) {
    next(err)
  }
}
