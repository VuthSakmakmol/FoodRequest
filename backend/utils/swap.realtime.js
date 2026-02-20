// backend/utils/swap.realtime.js
function s(v) {
  return String(v ?? '').trim()
}

function broadcastSwapRequest(io, doc, event = 'swap:req:updated') {
  if (!io || !doc) return

  const payload = { ...doc, _id: String(doc._id || doc.id || '') }

  // rooms (same pattern as your leave module style)
  io.to('admins').emit(event, payload)

  const requester = s(doc.requesterLoginId)
  const employeeId = s(doc.employeeId)

  if (requester) io.to(`user:${requester}`).emit(event, payload)
  if (employeeId) io.to(`employee:${employeeId}`).emit(event, payload)

  const manager = s(doc.managerLoginId)
  const gm = s(doc.gmLoginId)
  const coo = s(doc.cooLoginId)

  if (manager) io.to(`user:${manager}`).emit(event, payload)
  if (gm) io.to(`user:${gm}`).emit(event, payload)
  if (coo) io.to(`user:${coo}`).emit(event, payload)
}

module.exports = { broadcastSwapRequest }