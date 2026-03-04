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

  // ✅ always notify admins + requester
  io.to('admins').emit(event, payload)
  if (empId) io.to(`employee:${empId}`).emit(event, payload)

  emitUser(io, requester, event, payload)
  // optional fallback (if requesterLoginId sometimes equals employeeId)
  if (empId) emitUser(io, empId, event, payload)

  // which approvers exist in mode?
  const hasManager = mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
  const hasGm = mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY'
  const hasCoo =
    mode === 'MANAGER_AND_COO' ||
    mode === 'GM_AND_COO' ||
    mode === 'COO_ONLY' ||
    mode === 'GM_ONLY' ||
    mode === 'MANAGER_ONLY' // keep coo viewer restriction

  // ✅ pending routing (notify current approver + previous approvers for visibility)
  if (st === 'PENDING_MANAGER') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasCoo) emitUser(io, coo, event, payload) // viewer restriction
    return
  }

  if (st === 'PENDING_GM') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    if (hasCoo) emitUser(io, coo, event, payload) // viewer restriction
    return
  }

  if (st === 'PENDING_COO') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    if (hasCoo) emitUser(io, coo, event, payload)
    return
  }

  // ✅ final states: everyone involved sees result
  if (hasManager) emitUser(io, manager, event, payload)
  if (hasGm) emitUser(io, gm, event, payload)
  if (hasCoo) emitUser(io, coo, event, payload)
}

module.exports = { broadcastForgetScanRequest }