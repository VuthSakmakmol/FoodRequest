// backend/utils/forgetScan.realtime.js
function s(v) {
  return String(v ?? '').trim()
}

function broadcastForgetScanRequest(io, doc, event = 'forgetscan:req:updated') {
  if (!io || !doc) return

  const payload = { ...doc, _id: String(doc._id || doc.id || '') }

  // ✅ Admin viewers
  io.to('admins').emit(event, payload)

  // ✅ Employee + requester
  const employeeId = s(doc.employeeId)
  const requester = s(doc.requesterLoginId)

  if (employeeId) io.to(`employee:${employeeId}`).emit(event, payload)
  if (requester) io.to(`user:${requester}`).emit(event, payload)

  // ✅ Fallback: user room by employeeId (same Leave/SWAP pattern)
  if (employeeId) io.to(`user:${employeeId}`).emit(event, payload)

  // ✅ Approver rooms (critical for inbox realtime)
  const manager = s(doc.managerLoginId)
  const gm = s(doc.gmLoginId)
  const coo = s(doc.cooLoginId)

  if (manager) io.to(`user:${manager}`).emit(event, payload)
  if (gm) io.to(`user:${gm}`).emit(event, payload)
  if (coo) io.to(`user:${coo}`).emit(event, payload)
}

module.exports = { broadcastForgetScanRequest }