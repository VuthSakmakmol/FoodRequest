// src/utils/socket.js
import { io } from 'socket.io-client'

let socket = null
let isConnected = false
let authToken = ''

/* -------------------- Subscription state (persist across reconnect) -------------------- */
const subscribedRoles  = new Set()
const joinedBookings   = new Set()
const joinedEmployees  = new Set()
const joinedCompanies  = new Set()
const joinedUsers      = new Set()

let heartbeatId = null

/* -------------------- internal helpers -------------------- */
function wsOrigin() {
  // ✅ default: same origin (works behind Nginx reverse proxy)
  return (
    import.meta.env.VITE_WS_ORIGIN ||
    import.meta.env.VITE_API_BASE ||
    location.origin
  )
}

function normRole(r) {
  return String(r || '').toUpperCase().trim()
}

function startHeartbeat(sock) {
  if (heartbeatId) return
  heartbeatId = setInterval(() => {
    try {
      sock.emit('ping:client', Date.now())
    } catch {}
  }, 15000)
}

function stopHeartbeat() {
  if (!heartbeatId) return
  clearInterval(heartbeatId)
  heartbeatId = null
}

/* ✅ emit with ACK so we know subscribe succeeded */
function emitAck(sock, event, payload) {
  return new Promise((resolve) => {
    try {
      sock.emit(event, payload, (res) => resolve(res || { ok: true }))
    } catch {
      resolve({ ok: false, error: 'EMIT_FAILED' })
    }
  })
}

function replaySubscriptions(sock) {
  // Roles
  for (const role of subscribedRoles) {
    emitAck(sock, 'subscribe', { role })
  }

  // Rooms
  for (const id of joinedBookings)  emitAck(sock, 'subscribe', { bookingId: id })
  for (const id of joinedEmployees) emitAck(sock, 'subscribe', { employeeId: id })
  for (const id of joinedCompanies) emitAck(sock, 'subscribe', { companyId: id })
  for (const id of joinedUsers)     emitAck(sock, 'subscribe', { loginId: id })
}

function createSocket() {
  const s = io(wsOrigin(), {
    transports: ['websocket'],
    autoConnect: false, // ✅ IMPORTANT (no connect until token set)
    auth: authToken ? { token: authToken } : {},
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 8000,
  })

  s.on('connect', () => {
    isConnected = true
    replaySubscriptions(s)
  })

  s.on('disconnect', () => {
    isConnected = false
  })

  startHeartbeat(s)
  return s
}

function getSocket() {
  if (!socket) socket = createSocket()
  return socket
}

export default getSocket()

async function waitConnected() {
  const s = getSocket()
  return new Promise((resolve) => {
    if (isConnected && s.connected) return resolve()

    const onConnect = () => {
      s.off('connect', onConnect)
      resolve()
    }
    s.on('connect', onConnect)

    if (!s.connected) s.connect()
  })
}

/**
 * ✅ HARD reset all in-memory subscriptions
 * Use this on logout to prevent replaying stale rooms.
 */
export function resetSocketSubscriptions() {
  subscribedRoles.clear()
  joinedBookings.clear()
  joinedEmployees.clear()
  joinedCompanies.clear()
  joinedUsers.clear()
}

/**
 * Update socket auth token and reconnect with new JWT.
 * Call after login/restore, and on logout with ''.
 */
export function setSocketAuthToken(token) {
  authToken = token || ''
  const s = getSocket()

  s.auth = authToken ? { ...(s.auth || {}), token: authToken } : {}

  try {
    if (s.connected) s.disconnect()
    s.connect()
  } catch {}
}

/* -------------------- ROLE rooms (ADMIN/CHEF/DRIVER/... + LEAVE_*) -------------------- */
export async function subscribeRole(role) {
  const r = normRole(role)
  if (!r || subscribedRoles.has(r)) return

  const s = getSocket()
  await waitConnected()

  const res = await emitAck(s, 'subscribe', { role: r })
  if (!res?.ok) {
    console.warn('[socket] subscribeRole denied:', r, res?.error)
    return
  }

  subscribedRoles.add(r)
}

export async function unsubscribeRole(role) {
  const r = normRole(role)
  if (!r || !subscribedRoles.has(r)) return

  const s = getSocket()
  await waitConnected()

  await emitAck(s, 'unsubscribe', { role: r })
  subscribedRoles.delete(r)
}

export async function subscribeRoles(roles = []) {
  const uniq = Array.from(
    new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))
  ).filter(Boolean)

  for (const r of uniq) {
    // eslint-disable-next-line no-await-in-loop
    await subscribeRole(r)
  }
}

export async function unsubscribeRoles(roles = []) {
  const uniq = Array.from(
    new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))
  ).filter(Boolean)

  for (const r of uniq) {
    // eslint-disable-next-line no-await-in-loop
    await unsubscribeRole(r)
  }
}

/**
 * Backward compatible helper:
 * - subscribeRoleIfNeeded("ADMIN")
 * - subscribeRoleIfNeeded({ role:"ADMIN" })
 * - subscribeRoleIfNeeded({ roles:["LEAVE_USER","LEAVE_MANAGER"] })
 */
export function subscribeRoleIfNeeded(payload = {}) {
  if (typeof payload === 'string') {
    const role = normRole(payload)
    if (role) subscribeRole(role)
    return
  }

  const role = normRole(payload.role)
  const roles = Array.isArray(payload.roles) ? payload.roles : []

  if (roles.length) subscribeRoles(roles)
  else if (role) subscribeRole(role)
}

/* -------------------- BOOKING rooms -------------------- */
export async function subscribeBookingRooms(ids = []) {
  await waitConnected()
  const s = getSocket()

  const uniq = Array.from(new Set(ids.map(v => String(v || '').trim()).filter(Boolean)))

  for (const id of uniq) {
    if (joinedBookings.has(id)) continue
    const res = await emitAck(s, 'subscribe', { bookingId: id })
    if (res?.ok) joinedBookings.add(id)
    else console.warn('[socket] subscribe booking denied:', id, res?.error)
  }

  return async () => {
    await waitConnected()
    for (const id of uniq) {
      if (!joinedBookings.has(id)) continue
      await emitAck(s, 'unsubscribe', { bookingId: id })
      joinedBookings.delete(id)
    }
  }
}

/* -------------------- EMPLOYEE + COMPANY + USER rooms -------------------- */
export async function subscribeEmployeeIfNeeded(employeeId) {
  const id = String(employeeId || '').trim()
  if (!id || joinedEmployees.has(id)) return

  await waitConnected()
  const s = getSocket()

  const res = await emitAck(s, 'subscribe', { employeeId: id })
  if (res?.ok) joinedEmployees.add(id)
  else console.warn('[socket] subscribe employee denied:', id, res?.error)
}

export async function subscribeCompanyIfNeeded(companyId) {
  const id = String(companyId || '').trim()
  if (!id || joinedCompanies.has(id)) return

  await waitConnected()
  const s = getSocket()

  const res = await emitAck(s, 'subscribe', { companyId: id })
  if (res?.ok) joinedCompanies.add(id)
  else console.warn('[socket] subscribe company denied:', id, res?.error)
}

export async function subscribeUserIfNeeded(loginId) {
  const id = String(loginId || '').trim()
  if (!id || joinedUsers.has(id)) return

  await waitConnected()
  const s = getSocket()

  const res = await emitAck(s, 'subscribe', { loginId: id })
  if (res?.ok) joinedUsers.add(id)
  else console.warn('[socket] subscribe user denied:', id, res?.error)
}

/* -------------------- small helpers -------------------- */
export function onSocket(event, handler) {
  const s = getSocket()
  s.on(event, handler)
  return () => s.off(event, handler)
}

/* optional: if you ever want to fully dispose (rare) */
export function destroySocket() {
  try {
    resetSocketSubscriptions()
    stopHeartbeat()
    const s = getSocket()
    if (s?.connected) s.disconnect()
    socket = null
  } catch {}
}
