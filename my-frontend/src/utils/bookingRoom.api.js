// src/utils/bookingRoom.api.js
import api from '@/utils/api'

/* ─────────────────────────────────────────────
 * constants
 * ───────────────────────────────────────────── */
export const BOOKING_ROOM_NAMES = ['Dark Room', 'Apsara Room', 'Angkor Room']
export const BOOKING_ROOM_MATERIALS = ['PROJECTOR', 'TV']

function s(v) {
  return String(v ?? '').trim()
}

function cleanParams(obj = {}) {
  const out = {}
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    if (typeof v === 'string' && !v.trim()) return
    out[k] = v
  })
  return out
}

function normalizeMaterials(materials = []) {
  return Array.isArray(materials)
    ? [...new Set(materials.map((v) => s(v).toUpperCase()).filter(Boolean))]
    : []
}

/* ─────────────────────────────────────────────
 * employee search (public directory reuse)
 * ───────────────────────────────────────────── */
export async function searchBookingRoomEmployees(params = {}) {
  const { q = '', activeOnly = true } = params
  const { data } = await api.get('/public/employees', {
    params: cleanParams({ q, activeOnly }),
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * public create
 * POST /api/public/booking-room
 * ───────────────────────────────────────────── */
export async function createBookingRoom(payload = {}) {
  const body = {
    employeeId: s(payload.employeeId),
    bookingDate: s(payload.bookingDate),
    timeStart: s(payload.timeStart),
    timeEnd: s(payload.timeEnd),

    meetingTitle: s(payload.meetingTitle),
    purpose: s(payload.purpose),
    participantEstimate: Number(payload.participantEstimate || 1),
    requirementNote: s(payload.requirementNote),

    roomRequired: !!payload.roomRequired,
    roomName: payload.roomRequired ? s(payload.roomName) : '',

    materialRequired: !!payload.materialRequired,
    materials: payload.materialRequired ? normalizeMaterials(payload.materials) : [],
  }

  const { data } = await api.post('/public/booking-room', body)
  return data
}

/* ─────────────────────────────────────────────
 * public my list
 * GET /api/public/booking-room/my?employeeId=...
 * ───────────────────────────────────────────── */
export async function getMyBookingRooms(employeeId) {
  const { data } = await api.get('/public/booking-room/my', {
    params: { employeeId: s(employeeId) },
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * public schedule
 * GET /api/public/booking-room/schedule
 * ───────────────────────────────────────────── */
export async function getBookingRoomSchedule(params = {}) {
  const { data } = await api.get('/public/booking-room/schedule', {
    params: cleanParams({
      date: s(params.date),
      roomName: s(params.roomName),
      material: s(params.material),
      showPending: params.showPending === true ? 'true' : undefined,
    }),
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * public update own request
 * PATCH /api/public/booking-room/:id
 * ───────────────────────────────────────────── */
export async function updateBookingRoom(id, payload = {}) {
  const body = {
    employeeId: s(payload.employeeId),
    bookingDate: s(payload.bookingDate),
    timeStart: s(payload.timeStart),
    timeEnd: s(payload.timeEnd),

    meetingTitle: s(payload.meetingTitle),
    purpose: s(payload.purpose),
    participantEstimate: Number(payload.participantEstimate || 1),
    requirementNote: s(payload.requirementNote),

    roomRequired: !!payload.roomRequired,
    roomName: payload.roomRequired ? s(payload.roomName) : '',

    materialRequired: !!payload.materialRequired,
    materials: payload.materialRequired ? normalizeMaterials(payload.materials) : [],
  }

  const { data } = await api.patch(`/public/booking-room/${id}`, body)
  return data
}

/* ─────────────────────────────────────────────
 * public cancel own request
 * POST /api/public/booking-room/:id/cancel
 * ───────────────────────────────────────────── */
export async function cancelBookingRoom(id, payload = {}) {
  const body = {
    employeeId: s(payload.employeeId),
    cancelReason: s(payload.cancelReason),
  }

  const { data } = await api.post(`/public/booking-room/${id}/cancel`, body)
  return data
}

/* ─────────────────────────────────────────────
 * room admin inbox
 * GET /api/booking-room/room/inbox?scope=...
 * ───────────────────────────────────────────── */
export async function getRoomBookingInbox(params = {}) {
  const { data } = await api.get('/booking-room/room/inbox', {
    params: cleanParams({
      scope: s(params.scope || 'ACTIONABLE'),
    }),
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * material admin inbox
 * GET /api/booking-room/material/inbox?scope=...
 * ───────────────────────────────────────────── */
export async function getMaterialBookingInbox(params = {}) {
  const { data } = await api.get('/booking-room/material/inbox', {
    params: cleanParams({
      scope: s(params.scope || 'ACTIONABLE'),
    }),
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * room admin decision
 * POST /api/booking-room/:id/room-decision
 * ───────────────────────────────────────────── */
export async function decideRoomBooking(id, payload = {}) {
  const body = {
    decision: s(payload.decision).toUpperCase(),
    note: s(payload.note),
  }

  const { data } = await api.post(`/booking-room/${id}/room-decision`, body)
  return data
}

/* ─────────────────────────────────────────────
 * material admin decision
 * POST /api/booking-room/:id/material-decision
 * ───────────────────────────────────────────── */
export async function decideMaterialBooking(id, payload = {}) {
  const body = {
    decision: s(payload.decision).toUpperCase(),
    note: s(payload.note),
  }

  const { data } = await api.post(`/booking-room/${id}/material-decision`, body)
  return data
}

/* ─────────────────────────────────────────────
 * shared admin list
 * GET /api/booking-room/admin/list
 * ───────────────────────────────────────────── */
export async function getBookingRoomAdminList(params = {}) {
  const { data } = await api.get('/booking-room/admin/list', {
    params: cleanParams({
      date: s(params.date),
      dateFrom: s(params.dateFrom),
      dateTo: s(params.dateTo),
      overallStatus: s(params.overallStatus),
      roomStatus: s(params.roomStatus),
      materialStatus: s(params.materialStatus),
      q: s(params.q),
    }),
  })
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * shared admin export
 * returns axios response/blob
 * GET /api/booking-room/admin/export
 * ───────────────────────────────────────────── */
export async function exportBookingRoomAdminExcel(params = {}) {
  return api.get('/booking-room/admin/export', {
    params: cleanParams({
      date: s(params.date),
      dateFrom: s(params.dateFrom),
      dateTo: s(params.dateTo),
      overallStatus: s(params.overallStatus),
      roomStatus: s(params.roomStatus),
      materialStatus: s(params.materialStatus),
      q: s(params.q),
    }),
    responseType: 'blob',
  })
}

/* ─────────────────────────────────────────────
 * admin helper lists
 * ───────────────────────────────────────────── */
export async function getRoomAdmins() {
  const { data } = await api.get('/booking-room/admin/room-admins')
  return Array.isArray(data) ? data : []
}

export async function getMaterialAdmins() {
  const { data } = await api.get('/booking-room/admin/material-admins')
  return Array.isArray(data) ? data : []
}

/* ─────────────────────────────────────────────
 * helpers for frontend UI
 * ───────────────────────────────────────────── */
export function canEditOrCancelBookingRoom(row = {}) {
  const overall = s(row.overallStatus).toUpperCase()
  const roomStatus = s(row.roomStatus).toUpperCase()
  const materialStatus = s(row.materialStatus).toUpperCase()

  if (overall === 'CANCELLED') return false
  if (roomStatus === 'APPROVED') return false
  if (materialStatus === 'APPROVED') return false
  return true
}

export function bookingRoomStatusLabel(status) {
  const v = s(status).toUpperCase()
  if (!v) return 'Unknown'
  return v.replace(/_/g, ' ')
}

export function bookingRoomTypeLabel(row = {}) {
  const room = !!row.roomRequired
  const material = !!row.materialRequired
  if (room && material) return 'Room + Material'
  if (room) return 'Room Only'
  if (material) return 'Material Only'
  return 'Unknown'
}

export function normalizeBookingRoomForm(payload = {}) {
  return {
    employeeId: s(payload.employeeId),
    bookingDate: s(payload.bookingDate),
    timeStart: s(payload.timeStart),
    timeEnd: s(payload.timeEnd),
    meetingTitle: s(payload.meetingTitle),
    purpose: s(payload.purpose),
    participantEstimate: Number(payload.participantEstimate || 1),
    requirementNote: s(payload.requirementNote),
    roomRequired: !!payload.roomRequired,
    roomName: payload.roomRequired ? s(payload.roomName) : '',
    materialRequired: !!payload.materialRequired,
    materials: payload.materialRequired ? normalizeMaterials(payload.materials) : [],
  }
}

export default {
  BOOKING_ROOM_NAMES,
  BOOKING_ROOM_MATERIALS,

  searchBookingRoomEmployees,
  createBookingRoom,
  getMyBookingRooms,
  getBookingRoomSchedule,
  updateBookingRoom,
  cancelBookingRoom,

  getRoomBookingInbox,
  getMaterialBookingInbox,
  decideRoomBooking,
  decideMaterialBooking,

  getBookingRoomAdminList,
  exportBookingRoomAdminExcel,
  getRoomAdmins,
  getMaterialAdmins,

  canEditOrCancelBookingRoom,
  bookingRoomStatusLabel,
  bookingRoomTypeLabel,
  normalizeBookingRoomForm,
}