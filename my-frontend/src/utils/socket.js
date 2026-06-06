// src/utils/socket.js
import { io } from 'socket.io-client'

let socket = null
let authToken = ''
let heartbeatId = null

const subscribedRoles = new Set()
const joinedBookings = new Set()
const joinedEmployees = new Set()
const joinedCompanies = new Set()
const joinedUsers = new Set()

function wsOrigin() {
  const raw =
    import.meta.env.VITE_WS_ORIGIN ||
    import.meta.env.VITE_API_BASE ||
    import.meta.env.VITE_API_URL ||
    location.origin

  return String(raw).replace(/\/api\/?$/, '').replace(/\/$/, '')
}

function normRole(v) {
  return String(v || '').toUpperCase().trim()
}

function normId(v) {
  return String(v || '').trim()
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

function createSocket() {
  const s = io(wsOrigin(), {
    transports: ['websocket'],
    autoConnect: false,
    auth: authToken ? { token: authToken } : {},
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
    timeout: 8000,
  })

  s.on('connect', () => {
    startHeartbeat(s)
    replaySubscriptions(s)
  })

  s.on('disconnect', () => {
    stopHeartbeat()
  })

  s.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err?.message || err)
  })

  return s
}

function getSocket() {
  if (!socket) socket = createSocket()
  return socket
}

export default getSocket()

function connectIfNeeded() {
  const s = getSocket()

  try {
    if (!s.connected && !s.active) s.connect()
  } catch {}

  return s
}

function waitConnected(timeoutMs = 3500) {
  const s = connectIfNeeded()

  return new Promise((resolve) => {
    if (s.connected) return resolve(true)

    let done = false
    let timer = null

    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      s.off('connect', onConnect)
      s.off('connect_error', onError)
      resolve(ok)
    }

    const onConnect = () => finish(true)
    const onError = () => finish(false)

    s.once('connect', onConnect)
    s.once('connect_error', onError)

    timer = setTimeout(() => finish(false), timeoutMs)
  })
}

function emitAck(sock, event, payload, timeoutMs = 3500) {
  return new Promise((resolve) => {
    try {
      if (!sock?.connected) {
        resolve({ ok: false, error: 'SOCKET_NOT_CONNECTED' })
        return
      }

      sock.timeout(timeoutMs).emit(event, payload, (err, res) => {
        if (err) {
          resolve({ ok: false, error: err?.message || 'SOCKET_ACK_TIMEOUT' })
          return
        }

        resolve(res || { ok: true })
      })
    } catch (e) {
      resolve({ ok: false, error: e?.message || 'EMIT_FAILED' })
    }
  })
}

async function requestSubscribe(payload) {
  const s = getSocket()
  const ok = await waitConnected()

  if (!ok || !s.connected) {
    return { ok: false, error: 'SOCKET_NOT_CONNECTED' }
  }

  const res = await emitAck(s, 'subscribe', payload)

  if (!res?.ok) {
    console.warn('[socket] subscribe failed:', payload, res?.error)
  }

  return res
}

async function requestUnsubscribe(payload) {
  const s = getSocket()
  if (!s.connected) return { ok: true }

  const res = await emitAck(s, 'unsubscribe', payload)

  if (!res?.ok) {
    console.warn('[socket] unsubscribe failed:', payload, res?.error)
  }

  return res
}

async function replaySubscriptions(sock) {
  const tasks = []

  for (const role of subscribedRoles) tasks.push(emitAck(sock, 'subscribe', { role }))
  for (const id of joinedBookings) tasks.push(emitAck(sock, 'subscribe', { bookingId: id }))
  for (const id of joinedEmployees) tasks.push(emitAck(sock, 'subscribe', { employeeId: id }))
  for (const id of joinedCompanies) tasks.push(emitAck(sock, 'subscribe', { companyId: id }))
  for (const id of joinedUsers) tasks.push(emitAck(sock, 'subscribe', { loginId: id }))

  try {
    await Promise.allSettled(tasks)
  } catch {}
}

export function setSocketAuthToken(token) {
  const nextToken = token || ''
  const oldToken = authToken
  const s = getSocket()

  authToken = nextToken
  s.auth = nextToken ? { ...(s.auth || {}), token: nextToken } : {}

  try {
    if (!nextToken) {
      stopHeartbeat()
      if (s.connected || s.active) s.disconnect()
      return
    }

    if (nextToken === oldToken && (s.connected || s.active)) return

    if (s.connected || s.active) {
      s.disconnect()

      setTimeout(() => {
        try {
          if (authToken) s.connect()
        } catch {}
      }, 80)

      return
    }

    s.connect()
  } catch {}
}

export function resetSocketSubscriptions() {
  subscribedRoles.clear()
  joinedBookings.clear()
  joinedEmployees.clear()
  joinedCompanies.clear()
  joinedUsers.clear()
}

export async function subscribeRole(role) {
  const r = normRole(role)
  if (!r) return { ok: false, error: 'EMPTY_ROLE' }

  subscribedRoles.add(r)
  return requestSubscribe({ role: r })
}

export async function unsubscribeRole(role) {
  const r = normRole(role)
  if (!r) return { ok: true }

  subscribedRoles.delete(r)
  return requestUnsubscribe({ role: r })
}

export async function subscribeRoles(roles = []) {
  const uniq = Array.from(
    new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))
  ).filter(Boolean)

  for (const role of uniq) {
    subscribedRoles.add(role)
  }

  const results = []

  for (const role of uniq) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await requestSubscribe({ role }))
  }

  return results
}

export async function unsubscribeRoles(roles = []) {
  const uniq = Array.from(
    new Set((Array.isArray(roles) ? roles : [roles]).map(normRole))
  ).filter(Boolean)

  for (const role of uniq) {
    subscribedRoles.delete(role)
  }

  const results = []

  for (const role of uniq) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await requestUnsubscribe({ role }))
  }

  return results
}

export function subscribeRoleIfNeeded(payload = {}) {
  if (typeof payload === 'string') {
    const role = normRole(payload)
    if (role) void subscribeRole(role)
    return
  }

  const role = normRole(payload.role)
  const roles = Array.isArray(payload.roles) ? payload.roles : []

  if (roles.length) void subscribeRoles(roles)
  else if (role) void subscribeRole(role)

  const employeeId = normId(payload.employeeId)
  const loginId = normId(payload.loginId)
  const companyId = normId(payload.companyId || payload.company)

  if (employeeId) void subscribeEmployeeIfNeeded(employeeId)
  if (loginId) void subscribeUserIfNeeded(loginId)
  if (companyId) void subscribeCompanyIfNeeded(companyId)
}

export async function subscribeBookingRooms(ids = []) {
  const uniq = Array.from(
    new Set((Array.isArray(ids) ? ids : [ids]).map(normId))
  ).filter(Boolean)

  for (const id of uniq) {
    joinedBookings.add(id)
  }

  for (const id of uniq) {
    // eslint-disable-next-line no-await-in-loop
    await requestSubscribe({ bookingId: id })
  }

  return async () => {
    for (const id of uniq) {
      joinedBookings.delete(id)
      // eslint-disable-next-line no-await-in-loop
      await requestUnsubscribe({ bookingId: id })
    }
  }
}

export async function subscribeEmployeeIfNeeded(employeeId) {
  const id = normId(employeeId)
  if (!id) return { ok: false, error: 'EMPTY_EMPLOYEE_ID' }

  joinedEmployees.add(id)
  return requestSubscribe({ employeeId: id })
}

export async function subscribeCompanyIfNeeded(companyId) {
  const id = normId(companyId)
  if (!id) return { ok: false, error: 'EMPTY_COMPANY_ID' }

  joinedCompanies.add(id)
  return requestSubscribe({ companyId: id })
}

export async function subscribeUserIfNeeded(loginId) {
  const id = normId(loginId)
  if (!id) return { ok: false, error: 'EMPTY_LOGIN_ID' }

  joinedUsers.add(id)
  return requestSubscribe({ loginId: id })
}

export function onSocket(event, handler) {
  const s = getSocket()
  s.on(event, handler)
  return () => s.off(event, handler)
}

export function destroySocket() {
  try {
    resetSocketSubscriptions()
    stopHeartbeat()

    if (socket) {
      socket.removeAllListeners()
      if (socket.connected || socket.active) socket.disconnect()
      socket = null
    }
  } catch {}
}