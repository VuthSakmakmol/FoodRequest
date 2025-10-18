// src/utils/socket.js
import { io } from 'socket.io-client'

let socket = null
let isConnected = false

export function getSocket(token) {
  if (socket) return socket
  const wsOrigin =
    import.meta.env.VITE_WS_ORIGIN ||
    import.meta.env.VITE_API_BASE ||
    `${location.protocol}//${location.hostname}:4333`

  socket = io(wsOrigin, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 8000,
  })

  socket.on('connect', () => { isConnected = true })
  socket.on('disconnect', () => { isConnected = false })

  // socket.onAny((ev, ...args) => console.debug('[ws<=]', ev, args))

  setInterval(() => { try { socket.emit('ping:client', Date.now()) } catch {} }, 15000)

  return socket
}

const s = getSocket()
export default s

/* ---------- connect-aware joins ---------- */
const subscribedRoles = new Set()
const joinedBookings  = new Set()
const joinedEmployees = new Set()
const joinedCompanies = new Set()

function waitConnected() {
  return new Promise((resolve) => {
    if (isConnected) return resolve()
    const onConnect = () => { s.off('connect', onConnect); resolve() }
    s.on('connect', onConnect)
  })
}

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

export function onSocket(event, handler) {
  s.on(event, handler)
  return () => s.off(event, handler)
}

export function subscribeRoleIfNeeded(payload = {}) {
  const role = String(payload.role || '').toUpperCase()
  if (role) subscribeRole(role)
}
