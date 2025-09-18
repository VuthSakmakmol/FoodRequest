// src/utils/socket.js
import { io } from 'socket.io-client'

const base = (import.meta.env.VITE_API_URL || 'http://localhost:4333/api')
  .replace(/\/api\/?$/, '')

const socket = io(base, {
  transports: ['websocket'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  auth: () => ({
    token: localStorage.getItem('token') || '',
    role:  localStorage.getItem('authRole') || '',
    employeeId: localStorage.getItem('employeeId') || '',
  }),
})

/* verbose logs */
socket.onAny((ev, p) => {
  try { console.log('[socket:onAny]', ev, p?._id || p?.requestId || null) }
  catch { console.log('[socket:onAny]', ev) }
})
socket.on('connect', () => console.log('[socket] connect', socket.id))
socket.on('reconnect', n => console.log('[socket] reconnect', n))
socket.on('disconnect', r => console.log('[socket] disconnect', r))
socket.on('connect_error', e => console.log('[socket] connect_error', e?.message))

/* ------- subscribe helpers ------- */
export function subscribeEmployeeIfNeeded() {
  const employeeId = localStorage.getItem('employeeId') || ''
  if (!employeeId) return console.log('[emp] skip subscribe — no employeeId')
  socket.emit('subscribe', { employeeId: String(employeeId) }, ack =>
    console.log('[emp] subscribe ack', ack)
  )
}
export function subscribeRoleIfNeeded() {
  const role = localStorage.getItem('authRole') || ''
  if (!role) return console.log('[role] skip subscribe — no authRole')
  socket.emit('subscribe', { role }, ack =>
    console.log('[role] subscribe ack', ack)
  )
}
/* Back-compat alias some code expects */
export const subscribeRole = subscribeRoleIfNeeded

/* ------- unsubscribe helpers (⬅️ missing before) ------- */
export function unsubscribeRole() {
  const role = localStorage.getItem('authRole') || ''
  if (!role) return console.log('[role] skip unsubscribe — no authRole')
  socket.emit('unsubscribe', { role }, ack =>
    console.log('[role] unsubscribe ack', ack)
  )
}
export function unsubscribeEmployee() {
  const employeeId = localStorage.getItem('employeeId') || ''
  if (!employeeId) return console.log('[emp] skip unsubscribe — no employeeId')
  socket.emit('unsubscribe', { employeeId: String(employeeId) }, ack =>
    console.log('[emp] unsubscribe ack', ack)
  )
}

/* re-join on connect/reconnect */
socket.on('connect', () => {
  subscribeEmployeeIfNeeded()
  subscribeRoleIfNeeded()
})
socket.on('reconnect', () => {
  subscribeEmployeeIfNeeded()
  subscribeRoleIfNeeded()
})

export default socket
