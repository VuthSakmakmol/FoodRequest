/* eslint-disable no-console */
// backend/utils/forgetScan.realtime.js

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function emitUser(io, loginId, event, payload) {
  const id = s(loginId)
  if (id) io.to(`user:${id}`).emit(event, payload)
}

function broadcastForgetScanRequest(io, payload, event = 'forgetscan:req:updated') {
  if (!io || !payload) return

  const empId = s(payload.employeeId)
  const requester = s(payload.requesterLoginId)

  const manager = s(payload.managerLoginId)
  const gm = s(payload.gmLoginId)
  const coo = s(payload.cooLoginId)

  const mode = up(payload.approvalMode)
  const st = up(payload.status)

  // ✅ always
  io.to('admins').emit(event, payload)
  if (empId) io.to(`employee:${empId}`).emit(event, payload)
  emitUser(io, requester, event, payload)
  if (empId) emitUser(io, empId, event, payload) // optional fallback

  // helpers: which approvers exist in this mode?
  const hasManager = mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO'
  const hasGm = mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO'
  const hasCoo = mode === 'MANAGER_AND_COO' || mode === 'GM_AND_COO'

  // ✅ queue + history notifications
  if (st === 'PENDING_MANAGER') {
    if (hasManager) emitUser(io, manager, event, payload)
    return
  }

  if (st === 'PENDING_GM') {
    // manager already approved (if manager exists) -> keep manager seeing updates
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    return
  }

  if (st === 'PENDING_COO') {
    // ✅ key: previous approver(s) still see while waiting COO
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    if (hasCoo) emitUser(io, coo, event, payload)
    return
  }

  // final states: everyone sees result
  if (hasManager) emitUser(io, manager, event, payload)
  if (hasGm) emitUser(io, gm, event, payload)
  if (hasCoo) emitUser(io, coo, event, payload)
}

module.exports = { broadcastForgetScanRequest }