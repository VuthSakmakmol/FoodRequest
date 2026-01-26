/* eslint-disable no-console */
// backend/controllers/leave/leaveRequests.coo.controller.js

const LeaveRequest = require('../../models/leave/LeaveRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveRequest, broadcastLeaveProfile } = require('../../utils/leave.realtime')

// ✅ Telegram notify (safe-call)
const notify = require('../../services/leave/leave.telegram.notify')

/**
 * ✅ enum:
 * approvalMode: 'MANAGER_AND_GM' | 'GM_AND_COO'
 */

const COO_MODE = 'GM_AND_COO'

/**
 * ✅ NEW rule:
 * COO can only act when GM already approved and request moved to PENDING_COO.
 */
const COO_PENDING = ['PENDING_COO']

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map((r) => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

/**
 * ✅ Prefer loginId first (your LeaveRequest stores loginId strings)
 */
function actorLoginId(req) {
  return String(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '').trim()
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
}

function hasCooRole(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_COO') || isAdminViewer(req)
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

async function attachEmployeeInfo(docs = []) {
  const ids = [...new Set((docs || []).map((d) => String(d.employeeId || '').trim()).filter(Boolean))]
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
    console.warn('⚠️ recalcAndEmitProfile (COO) failed:', e?.message)
  }
}

/**
 * ✅ COO Inbox
 * NEW RULE:
 * - COO should NOT see request until GM approved and moved to PENDING_COO
 */
exports.listCooInbox = async (req, res) => {
  try {
    if (!hasCooRole(req)) return res.status(403).json({ message: 'Forbidden' })

    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) return res.status(400).json({ message: 'Missing user identity' })

    // ✅ Strict visibility:
    // - non-admin COO sees only his assigned and only relevant statuses
    // - admin sees all COO-mode requests, but still filtered to COO-stage/final
    const statusFilter = { $in: ['PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED'] }

    const query = isAdminViewer(req)
      ? { approvalMode: COO_MODE, status: statusFilter }
      : { approvalMode: COO_MODE, cooLoginId: me, status: statusFilter }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    console.error('listCooInbox error', e)
    return res.status(500).json({ message: 'Failed to load COO inbox.' })
  }
}

/**
 * ✅ COO Decision (race-safe)
 * NEW RULE:
 * - COO can decide ONLY when status === PENDING_COO
 */
exports.cooDecision = async (req, res) => {
  try {
    if (!hasCooRole(req)) return res.status(403).json({ message: 'Forbidden' })

    const me = actorLoginId(req)
    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const existing = await LeaveRequest.findById(id)
    if (!existing) return res.status(404).json({ message: 'Request not found' })

    // ✅ must be COO-mode to decide
    if (String(existing.approvalMode || '') !== COO_MODE) {
      return res.status(400).json({ message: 'This request is not in GM & COO approval mode.' })
    }

    // ✅ permission: cooLoginId must match (unless admin viewer)
    if (!isAdminViewer(req) && String(existing.cooLoginId || '') !== me) {
      return res.status(403).json({ message: 'Not your request' })
    }

    // ✅ Strict: COO can decide ONLY at PENDING_COO (GM must approve first)
    if (!COO_PENDING.includes(String(existing.status || ''))) {
      return res.status(400).json({
        message: `Request is ${existing.status}. COO can only decide when status is PENDING_COO.`,
      })
    }

    const act = String(action || '').toUpperCase()
    if (act === 'REJECT' && !String(comment || '').trim()) {
      return res.status(400).json({ message: 'Reject requires a reason.' })
    }

    let newStatus = ''
    if (act === 'APPROVE') newStatus = 'APPROVED'
    else if (act === 'REJECT') newStatus = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    const update = {
      $set: {
        status: newStatus,
        cooComment: String(comment || ''),
        cooDecisionAt: new Date(),
      },
    }

    // ✅ race-safe update: only if still PENDING_COO at update time
    const doc = await LeaveRequest.findOneAndUpdate(
      { _id: id, status: { $in: COO_PENDING }, approvalMode: COO_MODE },
      update,
      { new: true }
    )

    if (!doc) {
      const latest = await LeaveRequest.findById(id).lean()
      return res.status(409).json({
        message: `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`,
      })
    }

    const payload = await attachEmployeeInfoToOne(doc)

    // ✅ Realtime
    emitReq(req, payload, 'leave:req:updated')

    // ✅ Telegram notifications (safe)
    await safeNotify(notify.notifyCooDecisionToEmployee, doc)
    await safeNotify(notify.notifyLeaveAdminCooDecision, doc)
    await safeNotify(notify.notifyCooDecisionToGm, doc)

    // ✅ Recalc balances after final decision
    await recalcAndEmitProfile(req, doc.employeeId)

    return res.json(payload)
  } catch (e) {
    console.error('cooDecision error', e)
    return res.status(500).json({ message: 'Failed to decide COO request.' })
  }
}
