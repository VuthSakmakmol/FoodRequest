/* eslint-disable no-console */
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const { broadcastLeaveRequest } = require('../../utils/leave.realtime')

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

function actorLoginId(req) {
  return String(req.user?.loginId || req.user?.id || req.user?.sub || '').trim()
}

function getIo(req) {
  return req.io || req.app?.get('io') || null
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

exports.listCooInbox = async (req, res) => {
  try {
    const roles = getRoles(req)
    if (!roles.includes('LEAVE_COO') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const me = actorLoginId(req)

    const query = {
      approvalMode: 'GM_AND_COO',
      $or: [
        { cooLoginId: me },
        { cooLoginId: { $exists: false } },
        { cooLoginId: '' },
        { cooLoginId: null },
      ],
      status: { $in: ['PENDING_COO', 'GM_APPROVED'] },
    }

    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(rows || [])
  } catch (e) {
    console.error('listCooInbox error', e)
    return res.status(500).json({ message: 'Failed to load COO inbox.' })
  }
}

exports.cooDecision = async (req, res) => {
  try {
    const roles = getRoles(req)
    if (!roles.includes('LEAVE_COO') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const me = actorLoginId(req)
    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (String(doc.approvalMode || '') !== 'GM_AND_COO') {
      return res.status(400).json({ message: 'This request is not in COO approval flow.' })
    }

    if (!['PENDING_COO', 'GM_APPROVED'].includes(String(doc.status || ''))) {
      return res.status(400).json({ message: 'Request not in COO queue.' })
    }

    const act = String(action || '').toUpperCase()
    if (act === 'APPROVE') doc.status = 'APPROVED'
    else if (act === 'REJECT') doc.status = 'REJECTED'
    else return res.status(400).json({ message: 'Invalid action' })

    doc.cooLoginId = doc.cooLoginId || me
    doc.cooComment = String(comment || '')
    doc.cooDecisionAt = new Date()

    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)

    const io = getIo(req)
    if (io) {
      broadcastLeaveRequest(io, payload, 'leave:req:updated')
    }

    return res.json(payload)
  } catch (e) {
    console.error('cooDecision error', e)
    return res.status(500).json({ message: 'Failed to decide COO request.' })
  }
}
