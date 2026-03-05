// backend/utils/swap.realtime.js
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

function broadcastSwapRequest(io, doc, event = 'swap:req:updated') {
  if (!io || !doc) return

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
  if (empId) emitUser(io, empId, event, payload) // optional fallback

  // ✅ include *_ONLY in flags
  const hasManager = mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
  const hasGm = mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY'
  const hasCoo = mode === 'MANAGER_AND_COO' || mode === 'GM_AND_COO' || mode === 'COO_ONLY'

  // ✅ FYI viewers
  const gmFyiId = gm || FIXED.GM_LOGIN_ID
  const cooFyiId = coo || FIXED.COO_LOGIN_ID

  // MANAGER_ONLY: GM should get realtime (read-only)
  const gmIsFyiViewer = mode === 'MANAGER_ONLY'

  // GM_ONLY: COO should get realtime (read-only)
  const cooIsFyiViewer = mode === 'GM_ONLY'

  /* ───────── queue + history notifications ───────── */

  if (st === 'PENDING_MANAGER') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (gmIsFyiViewer) emitUser(io, gmFyiId, event, payload) // ✅ GM FYI
    return
  }

  if (st === 'PENDING_GM') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    if (cooIsFyiViewer) emitUser(io, cooFyiId, event, payload) // ✅ COO FYI
    return
  }

  if (st === 'PENDING_COO') {
    if (hasManager) emitUser(io, manager, event, payload)
    if (hasGm) emitUser(io, gm, event, payload)
    if (hasCoo) emitUser(io, coo, event, payload)

    // optional FYI: if you also want GM to see when waiting COO in MANAGER_ONLY (not common)
    // if (gmIsFyiViewer) emitUser(io, gmFyiId, event, payload)

    return
  }

  // final states: everyone sees result
  if (hasManager) emitUser(io, manager, event, payload)
  if (hasGm) emitUser(io, gm, event, payload)
  if (hasCoo) emitUser(io, coo, event, payload)

  // ✅ FYI final updates
  if (gmIsFyiViewer) emitUser(io, gmFyiId, event, payload)
  if (cooIsFyiViewer) emitUser(io, cooFyiId, event, payload)
}

module.exports = { broadcastSwapRequest }