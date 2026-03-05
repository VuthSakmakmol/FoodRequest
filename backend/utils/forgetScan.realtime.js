/* eslint-disable no-console */
// backend/utils/forgetScan.realtime.js

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

const FIXED = {
  GM_LOGIN_ID: 'leave_gm',
  COO_LOGIN_ID: 'leave_coo',
}

function emitUser(io, loginId, event, payload) {
  const id = s(loginId)
  if (id) io.to(`user:${id}`).emit(event, payload)
}

function broadcastForgetScanRequest(io, doc, event = 'forgetscan:req:updated') {
  if (!io || !doc) return

  // ✅ normalize payload (supports mongoose doc)
  const payload = typeof doc.toObject === 'function' ? doc.toObject() : doc
  payload._id = String(payload._id || payload.id || '')

  const empId = s(payload.employeeId)
  const requester = s(payload.requesterLoginId)

  const manager = s(payload.managerLoginId)
  const gm = s(payload.gmLoginId)
  const coo = s(payload.cooLoginId)

  const mode = up(payload.approvalMode)
  const st = up(payload.status)

  // ✅ always notify admins + requester + employee room
  io.to('admins').emit(event, payload)
  if (empId) io.to(`employee:${empId}`).emit(event, payload)

  emitUser(io, requester, event, payload)
  // optional fallback (if requesterLoginId sometimes equals employeeId)
  if (empId) emitUser(io, empId, event, payload)

  // ✅ approver existence in mode
  const hasManager = mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
  const hasGm = mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY'
  const hasCoo = mode === 'MANAGER_AND_COO' || mode === 'GM_AND_COO' || mode === 'COO_ONLY'

  // ✅ FYI viewers
  // - MANAGER_ONLY => GM should see (read-only)
  // - GM_ONLY => COO should see (read-only)
  const gmIsFyiViewer = mode === 'MANAGER_ONLY'
  const cooIsFyiViewer = mode === 'GM_ONLY'

  const gmFyiId = gm || FIXED.GM_LOGIN_ID
  const cooFyiId = coo || FIXED.COO_LOGIN_ID

  // ✅ COO viewer restriction rule (keep it):
  // Only emit to COOs that match doc.cooLoginId.
  // BUT for GM_ONLY FYI, you want fixed COO (leave_coo) even if doc.cooLoginId is empty.
  const cooViewerTarget = coo // no fallback here (restriction)
  const cooFyiTarget = cooFyiId // fallback allowed for GM_ONLY FYI

  /* ───────── pending routing (notify current approver + visibility) ───────── */

  if (st === 'PENDING_MANAGER') {
    if (hasManager) emitUser(io, manager, event, payload)

    // ✅ GM FYI for MANAGER_ONLY
    if (gmIsFyiViewer) emitUser(io, gmFyiId, event, payload)

    // keep your COO viewer restriction (only if cooLoginId exists)
    if (cooViewerTarget) emitUser(io, cooViewerTarget, event, payload)

    return
  }

  if (st === 'PENDING_GM') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)

    // ✅ COO FYI for GM_ONLY
    if (cooIsFyiViewer) emitUser(io, cooFyiTarget, event, payload)

    // keep your COO viewer restriction
    if (cooViewerTarget) emitUser(io, cooViewerTarget, event, payload)

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

  // ✅ FYI final updates too (useful for read-only inbox)
  if (gmIsFyiViewer) emitUser(io, gmFyiId, event, payload)
  if (cooIsFyiViewer) emitUser(io, cooFyiTarget, event, payload)
}

module.exports = { broadcastForgetScanRequest }