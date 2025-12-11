// src/utils/socket.js
import { io } from 'socket.io-client'

let socket = null
let isConnected = false
let authToken = ''

// ---- internal: create socket instance ----
function createSocket() {
  const wsOrigin =
    import.meta.env.VITE_WS_ORIGIN ||
    import.meta.env.VITE_API_BASE ||
    `${location.protocol}//${location.hostname}:4333`

  // initial token from localStorage (for page refresh)
  authToken = authToken || localStorage.getItem('token') || ''

  const s = io(wsOrigin, {
    transports: ['websocket'],
    auth: authToken ? { token: authToken } : undefined,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 8000,
  })

  s.on('connect', () => {
    isConnected = true
    // console.debug('[ws] connected', s.id)
  })

  s.on('disconnect', () => {
    isConnected = false
    // console.debug('[ws] disconnected')
  })

  // light heartbeat
  setInterval(() => {
    try {
      s.emit('ping:client', Date.now())
    } catch {}
  }, 15000)

  return s
}

// ensure singleton
if (!socket) {
  socket = createSocket()
}

const s = socket
export default s

/* ---------- connect-aware joins ---------- */
const subscribedRoles = new Set()
const joinedBookings  = new Set()
const joinedEmployees = new Set()
const joinedCompanies = new Set()
const joinedUsers     = new Set()

function waitConnected() {
  return new Promise((resolve) => {
    if (isConnected && s.connected) return resolve()

    const onConnect = () => {
      s.off('connect', onConnect)
      resolve()
    }
    s.on('connect', onConnect)
  })
}

/**
 * Update socket auth token and reconnect with the new JWT.
 * Call this from auth store after login/restore, and on logout with ''.
 */
export function setSocketAuthToken(token) {
  authToken = token || ''

  if (!socket) {
    socket = createSocket()
    return
  }

  socket.auth = authToken ? { ...(socket.auth || {}), token: authToken } : {}

  if (socket.connected) {
    socket.disconnect()
  }
  socket.connect()
}

/* ---------- ROLE rooms (ADMIN, CHEF, DRIVER, MESSENGER, LEAVE_MANAGER, LEAVE_GM, etc.) ---------- */
export async function subscribeRole(role) {
  role = String(role || '').toUpperCase()
  if (!role || subscribedRoles.has(role)) return

  await waitConnected()
  s.emit('subscribe', { role }, () => {})
  subscribedRoles.add(role)
}

export async function unsubscribeRole(role) {
  role = String(role || '').toUpperCase()
  if (!role || !subscribedRoles.has(role)) return

  await waitConnected()
  s.emit('unsubscribe', { role }, () => {})
  subscribedRoles.delete(role)
}

/* Helper: accept either string or { role } */
export function subscribeRoleIfNeeded(payload = {}) {
  const role =
    typeof payload === 'string'
      ? String(payload || '').toUpperCase()
      : String(payload.role || '').toUpperCase()

  if (role) subscribeRole(role)
}

/* ---------- BOOKING rooms ---------- */
export async function subscribeBookingRooms(ids = []) {
  await waitConnected()

  const uniq = Array.from(new Set(ids.map(String).filter(Boolean)))

  uniq.forEach((id) => {
    if (joinedBookings.has(id)) return
    s.emit('subscribe', { bookingId: id }, () => {})
    joinedBookings.add(id)
  })

  return async () => {
    await waitConnected()
    uniq.forEach((id) => {
      if (!joinedBookings.has(id)) return
      s.emit('unsubscribe', { bookingId: id }, () => {})
      joinedBookings.delete(id)
    })
  }
}

/* ---------- EMPLOYEE + COMPANY + USER rooms ---------- */
export async function subscribeEmployeeIfNeeded(employeeId) {
  const id = String(employeeId || '')
  if (!id || joinedEmployees.has(id)) return

  await waitConnected()
  s.emit('subscribe', { employeeId: id }, () => {})
  joinedEmployees.add(id)
}

export async function subscribeCompanyIfNeeded(companyId) {
  const id = String(companyId || '')
  if (!id || joinedCompanies.has(id)) return

  await waitConnected()
  s.emit('subscribe', { companyId: id }, () => {})
  joinedCompanies.add(id)
}

export async function subscribeUserIfNeeded(loginId) {
  const id = String(loginId || '')
  if (!id || joinedUsers.has(id)) return

  await waitConnected()
  s.emit('subscribe', { loginId: id }, () => {})
  joinedUsers.add(id)
}

/* ---------- small helpers ---------- */
export function onSocket(event, handler) {
  s.on(event, handler)
  return () => s.off(event, handler)
}
