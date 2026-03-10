/* eslint-disable no-console */
// backend/utils/bookingRoom.realtime.js

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function arr(v) {
  return Array.isArray(v) ? v : []
}

function normalizePayload(doc) {
  const raw = typeof doc?.toObject === 'function'
    ? doc.toObject()
    : { ...(doc || {}) }

  return {
    _id: String(raw._id || raw.id || raw.bookingId || ''),
    bookingId: String(raw._id || raw.id || raw.bookingId || ''),

    employeeId: s(raw.employeeId),
    requesterLoginId:
      s(raw.requesterLoginId) ||
      s(raw.createdByLoginId) ||
      s(raw.employeeLoginId) ||
      s(raw.employee?.loginId),

    createdByLoginId: s(raw.createdByLoginId),

    employee: raw.employee || null,

    bookingDate: s(raw.bookingDate),
    timeStart: s(raw.timeStart),
    timeEnd: s(raw.timeEnd),

    meetingTitle: s(raw.meetingTitle),
    purpose: s(raw.purpose),
    participantEstimate: Number(raw.participantEstimate || 0),
    requirementNote: s(raw.requirementNote),

    roomRequired: !!raw.roomRequired,
    roomId: raw.roomId || null,
    roomCode: s(raw.roomCode),
    roomName: s(raw.roomName),
    room: raw.room || null,

    materialRequired: !!raw.materialRequired,
    materials: arr(raw.materials),

    roomStatus: s(raw.roomStatus),
    materialStatus: s(raw.materialStatus),
    overallStatus: s(raw.overallStatus),

    roomApproval: raw.roomApproval || null,
    materialApproval: raw.materialApproval || null,

    cancelReason: s(raw.cancelReason),
    submittedVia: s(raw.submittedVia),

    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  }
}

/* ─────────────────────────────────────────────
 * Internal emit helpers
 * ───────────────────────────────────────────── */
function emitToRoom(io, room, event, payload) {
  const name = s(room)
  if (!io || !name || !event) return
  io.to(name).emit(event, payload)
}

function emitToRole(io, role, event, payload) {
  const r = up(role)
  if (!r) return
  io.to(r).emit(event, payload)
}

function emitToUser(io, loginId, event, payload) {
  const id = s(loginId)
  if (!id) return
  io.to(`user:${id}`).emit(event, payload)
}

function emitToEmployee(io, employeeId, event, payload) {
  const id = s(employeeId)
  if (!id) return
  io.to(`employee:${id}`).emit(event, payload)
}

/* ─────────────────────────────────────────────
 * Audience targeting
 * ───────────────────────────────────────────── */
function emitBookingRoomAudience(io, event, payload, options = {}) {
  if (!io || !event || !payload) return

  const {
    includePublic = false,
    includeAdmins = true,
    includeRoomAdmin = true,
    includeMaterialAdmin = true,
    includeAdminRoles = true,
    includeRequester = true,
  } = options

  const employeeId = s(payload.employeeId)
  const requesterLoginId =
    s(payload.requesterLoginId) ||
    s(payload.createdByLoginId) ||
    s(payload.employee?.loginId)

  if (includeAdmins) {
    emitToRoom(io, 'admins', event, payload)
  }

  if (includeRoomAdmin && payload.roomRequired) {
    emitToRole(io, 'ROOM_ADMIN', event, payload)
  }

  if (includeMaterialAdmin && payload.materialRequired) {
    emitToRole(io, 'MATERIAL_ADMIN', event, payload)
  }

  if (includeAdminRoles) {
    emitToRole(io, 'ADMIN', event, payload)
    emitToRole(io, 'ROOT_ADMIN', event, payload)
  }

  if (includeRequester) {
    emitToEmployee(io, employeeId, event, payload)
    emitToUser(io, requesterLoginId, event, payload)

    // compatibility fallback
    if (employeeId) emitToUser(io, employeeId, event, payload)
  }

  // only for booking-room public pages
  if (includePublic) {
    io.emit(event, payload)
  }
}

/* ─────────────────────────────────────────────
 * Request events
 * ───────────────────────────────────────────── */
function broadcastBookingRoomRequest(io, doc, event = 'bookingroom:req:updated') {
  if (!io || !doc) return

  const payload = normalizePayload(doc)

  emitBookingRoomAudience(io, event, payload, {
    includePublic: true,   // requester/public pages may need refresh
    includeAdmins: true,
    includeRoomAdmin: true,
    includeMaterialAdmin: true,
    includeAdminRoles: true,
    includeRequester: true,
  })
}

/* ─────────────────────────────────────────────
 * Availability / schedule change
 * ───────────────────────────────────────────── */
function broadcastBookingRoomAvailability(io, doc, event = 'bookingroom:availability:changed') {
  if (!io || !doc) return

  const payload = normalizePayload(doc)

  emitBookingRoomAudience(io, event, payload, {
    includePublic: true,   // public booking/schedule must react instantly
    includeAdmins: true,
    includeRoomAdmin: true,
    includeMaterialAdmin: true,
    includeAdminRoles: true,
    includeRequester: true,
  })
}

/* ─────────────────────────────────────────────
 * Master CRUD events
 * ───────────────────────────────────────────── */
function broadcastBookingRoomMaster(io, payload, event) {
  if (!io || !payload || !event) return

  const data = normalizePayload(payload)

  // admin / owners
  emitToRoom(io, 'admins', event, data)
  emitToRole(io, 'ROOM_ADMIN', event, data)
  emitToRole(io, 'MATERIAL_ADMIN', event, data)
  emitToRole(io, 'ADMIN', event, data)
  emitToRole(io, 'ROOT_ADMIN', event, data)

  // public booking form dropdowns may also need refresh
  io.emit(event, data)
}

function broadcastBookingRoomMastersChanged(io, payload = {}, event = 'bookingroom:masters:changed') {
  if (!io) return

  const data = normalizePayload(payload)

  emitToRoom(io, 'admins', event, data)
  emitToRole(io, 'ROOM_ADMIN', event, data)
  emitToRole(io, 'MATERIAL_ADMIN', event, data)
  emitToRole(io, 'ADMIN', event, data)
  emitToRole(io, 'ROOT_ADMIN', event, data)

  io.emit(event, data)
}

/* ─────────────────────────────────────────────
 * Optional granular events
 * ───────────────────────────────────────────── */
function broadcastBookingRoomRoomInbox(io, doc, event = 'bookingroom:room-inbox:changed') {
  if (!io || !doc) return
  const payload = normalizePayload(doc)

  emitToRole(io, 'ROOM_ADMIN', event, payload)
  emitToRole(io, 'ADMIN', event, payload)
  emitToRole(io, 'ROOT_ADMIN', event, payload)
  emitToRoom(io, 'admins', event, payload)
}

function broadcastBookingRoomMaterialInbox(io, doc, event = 'bookingroom:material-inbox:changed') {
  if (!io || !doc) return
  const payload = normalizePayload(doc)

  emitToRole(io, 'MATERIAL_ADMIN', event, payload)
  emitToRole(io, 'ADMIN', event, payload)
  emitToRole(io, 'ROOT_ADMIN', event, payload)
  emitToRoom(io, 'admins', event, payload)
}

module.exports = {
  normalizePayload,

  broadcastBookingRoomRequest,
  broadcastBookingRoomAvailability,

  broadcastBookingRoomMaster,
  broadcastBookingRoomMastersChanged,

  // optional extra helpers
  broadcastBookingRoomRoomInbox,
  broadcastBookingRoomMaterialInbox,
}