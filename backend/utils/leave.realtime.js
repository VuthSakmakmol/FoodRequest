// backend/utils/leave.realtime.js

function safeId(v) {
  return String(v || '').trim()
}
function up(v) {
  return safeId(v).toUpperCase()
}

const FIXED = {
  GM_LOGIN_ID: 'leave_gm',
  COO_LOGIN_ID: 'leave_coo',
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
  const mode = up(reqDoc?.approvalMode)

  // dedupe recipients (avoid double emit)
  const recipients = new Set()

  // base audiences
  io.to(ROOMS.ADMINS).emit(event, reqDoc)

  if (employeeId) {
    recipients.add(employeeId) // will also use as user room below
    io.to(ROOMS.EMPLOYEE(employeeId)).emit(event, reqDoc)
    io.to(ROOMS.USER(employeeId)).emit(event, reqDoc)
  }

  // normal approver ids
  const managerLoginId = safeId(reqDoc?.managerLoginId)
  const adminLoginId = safeId(reqDoc?.adminLoginId)
  const gmLoginId = safeId(reqDoc?.gmLoginId)
  const cooLoginId = safeId(reqDoc?.cooLoginId)

  if (managerLoginId) recipients.add(managerLoginId)
  if (adminLoginId) recipients.add(adminLoginId)
  if (gmLoginId) recipients.add(gmLoginId)
  if (cooLoginId) recipients.add(cooLoginId)

  // ✅ FYI viewers
  // MANAGER_ONLY -> GM should receive realtime (read-only)
  if (mode === 'MANAGER_ONLY') {
    recipients.add(gmLoginId || FIXED.GM_LOGIN_ID)
  }

  // GM_ONLY -> COO should receive realtime (read-only)
  if (mode === 'GM_ONLY') {
    recipients.add(cooLoginId || FIXED.COO_LOGIN_ID)
  }

  // emit to all user rooms
  for (const loginId of recipients) {
    if (!loginId) continue
    io.to(ROOMS.USER(loginId)).emit(event, reqDoc)
  }
}

module.exports = { broadcastLeaveProfile, broadcastLeaveRequest }