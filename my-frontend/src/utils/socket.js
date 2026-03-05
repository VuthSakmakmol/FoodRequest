// src/utils/socket.js
import { io } from 'socket.io-client'

let socket = null
let isConnected = false
let authToken = ''

/* -------------------- Subscription state (persist across reconnect) -------------------- */
const subscribedRoles = new Set()
const joinedBookings = new Set()
const joinedEmployees = new Set()
const joinedCompanies = new Set()
const joinedUsers = new Set()

let heartbeatId = null

/* -------------------- internal helpers -------------------- */
function wsOrigin() {
  // ✅ default: same origin (works behind Nginx reverse proxy)
  return import.meta.env.VITE_WS_ORIGIN || import.meta.env.VITE_API_BASE || location.origin
}

function normRole(r) {
  return String(r || '').toUpperCase().trim()
}

function normId(v) {
  return String(v || '').trim()
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

function startHeartbeat(sock) {
  if (heartbeatId) return
  heartbeatId = setInterval(() => {
    try {
      if (sock?.connected) sock.emit('ping:client', Date.now())
    } catch {}
  }, 15000)
}

function stopHeartbeat() {
  if (!heartbeatId) return
  clearInterval(heartbeatId)
  heartbeatId = null
}

/* ✅ replay subscriptions AFTER connect */
async function replaySubscriptions(sock) {
  const tasks = []

  // Roles
  for (const role of subscribedRoles) {
    tasks.push(emitAck(sock, 'subscribe', { role }))
  }

  // Rooms
  for (const id of joinedBookings) tasks.push(emitAck(sock, 'subscribe', { bookingId: id }))
  for (const id of joinedEmployees) tasks.push(emitAck(sock, 'subscribe', { employeeId: id }))
  for (const id of joinedCompanies) tasks.push(emitAck(sock, 'subscribe', { companyId: id }))
  for (const id of joinedUsers) tasks.push(emitAck(sock, 'subscribe', { loginId: id }))

  // We don't want a single failure to break the rest
  try {
    await Promise.all(tasks)
  } catch {}
}

function createSocket() {
  const s = io(wsOrigin(), {
    transports: ['websocket'],
    autoConnect: false, // ✅ IMPORTANT (no connect until token set)
    auth: authToken ? { token: authToken } : {},
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 8000,
  })

  s.on('connect', async () => {
    isConnected = true
    startHeartbeat(s)
    await replaySubscriptions(s)
  })

  s.on('disconnect', () => {
    isConnected = false
    stopHeartbeat()
  })

  s.on('connect_error', (err) => {
    // ✅ super useful in production debugging
    console.warn('[socket] connect_error:', err?.message || err)
  })

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

  // Update auth payload used by Socket.IO
  s.auth = authToken ? { ...(s.auth || {}), token: authToken } : {}

  try {
    if (!authToken) {
      // ✅ logout: disconnect and do NOT reconnect
      if (s.connected) s.disconnect()
      return
    }

    // ✅ login/restore: reconnect with new token
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
  const uniq = Array.from(new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))).filter(
    Boolean
  )

  for (const r of uniq) {
    // eslint-disable-next-line no-await-in-loop
    await subscribeRole(r)
  }
}

export async function unsubscribeRoles(roles = []) {
  const uniq = Array.from(new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))).filter(
    Boolean
  )

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
  // string form
  if (typeof payload === 'string') {
    const role = normRole(payload)
    if (role) subscribeRole(role)
    return
  }

  // roles/role
  const role = normRole(payload.role)
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  if (roles.length) subscribeRoles(roles)
  else if (role) subscribeRole(role)

  // ✅ ALSO join rooms when provided
  const employeeId = normId(payload.employeeId)
  const loginId = normId(payload.loginId)
  const companyId = normId(payload.companyId || payload.company)

  if (employeeId) subscribeEmployeeIfNeeded(employeeId)
  if (loginId) subscribeUserIfNeeded(loginId)
  if (companyId) subscribeCompanyIfNeeded(companyId)
}

/* -------------------- BOOKING rooms -------------------- */
export async function subscribeBookingRooms(ids = []) {
  await waitConnected()
  const s = getSocket()

  const uniq = Array.from(new Set(ids.map(normId).filter(Boolean)))

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
  const id = normId(employeeId)
  if (!id || joinedEmployees.has(id)) return

  await waitConnected()
  const s = getSocket()

  const res = await emitAck(s, 'subscribe', { employeeId: id })
  if (res?.ok) joinedEmployees.add(id)
  else console.warn('[socket] subscribe employee denied:', id, res?.error)
}

export async function subscribeCompanyIfNeeded(companyId) {
  const id = normId(companyId)
  if (!id || joinedCompanies.has(id)) return

  await waitConnected()
  const s = getSocket()

  const res = await emitAck(s, 'subscribe', { companyId: id })
  if (res?.ok) joinedCompanies.add(id)
  else console.warn('[socket] subscribe company denied:', id, res?.error)
}

export async function subscribeUserIfNeeded(loginId) {
  const id = normId(loginId)
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