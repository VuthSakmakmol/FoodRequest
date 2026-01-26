// backend/utils/leave.realtime.js

function safeId(v) {
  return String(v || '').trim()
}

const ROOMS = {
  ADMINS: 'admins',
  EMPLOYEE: (employeeId) => `employee:${safeId(employeeId)}`,
  USER: (loginId) => `user:${safeId(loginId)}`,
}

function broadcastLeaveProfile(io, profile, event = 'leave:profile:updated') {
  if (!io) return
  const employeeId = safeId(profile?.employeeId || profile?.employeeLoginId)

  io.to(ROOMS.ADMINS).emit(event, profile)
  if (employeeId) io.to(ROOMS.EMPLOYEE(employeeId)).emit(event, profile)
  if (employeeId) io.to(ROOMS.USER(employeeId)).emit(event, profile)

  const managerLoginId = safeId(profile?.managerLoginId)
  const adminLoginId = safeId(profile?.adminLoginId)
  const gmLoginId = safeId(profile?.gmLoginId)
  const cooLoginId = safeId(profile?.cooLoginId)

  if (managerLoginId) io.to(ROOMS.USER(managerLoginId)).emit(event, profile)
  if (adminLoginId) io.to(ROOMS.USER(adminLoginId)).emit(event, profile)
  if (gmLoginId) io.to(ROOMS.USER(gmLoginId)).emit(event, profile)
  if (cooLoginId) io.to(ROOMS.USER(cooLoginId)).emit(event, profile)
}

function broadcastLeaveRequest(io, reqDoc, event = 'leave:req:updated') {
  if (!io) return
  const employeeId = safeId(reqDoc?.employeeId)

  io.to(ROOMS.ADMINS).emit(event, reqDoc)
  if (employeeId) io.to(ROOMS.EMPLOYEE(employeeId)).emit(event, reqDoc)
  if (employeeId) io.to(ROOMS.USER(employeeId)).emit(event, reqDoc)

  const managerLoginId = safeId(reqDoc?.managerLoginId)
  const adminLoginId = safeId(reqDoc?.adminLoginId)
  const gmLoginId = safeId(reqDoc?.gmLoginId)
  const cooLoginId = safeId(reqDoc?.cooLoginId)

  if (managerLoginId) io.to(ROOMS.USER(managerLoginId)).emit(event, reqDoc)
  if (adminLoginId) io.to(ROOMS.USER(adminLoginId)).emit(event, reqDoc)
  if (gmLoginId) io.to(ROOMS.USER(gmLoginId)).emit(event, reqDoc)
  if (cooLoginId) io.to(ROOMS.USER(cooLoginId)).emit(event, reqDoc)
}

module.exports = { broadcastLeaveProfile, broadcastLeaveRequest }
