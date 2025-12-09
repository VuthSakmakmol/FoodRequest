// backend/utils/realtime.js
const jwt = require('jsonwebtoken')

/* ───────────────────────────
 *  Room naming helpers
 * ─────────────────────────── */
const ROOMS = {
  ADMINS: 'admins',
  CHEFS: 'chefs',

  // NEW: role-wide rooms for transportation
  DRIVERS: 'drivers',
  MESSENGERS: 'messengers',

  EMPLOYEE: (id) => `employee:${String(id)}`,
  COMPANY: (id)  => `company:${String(id)}`,
  BOOKING: (id)  => `booking:${String(id)}`,
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const log = (...args) => {
  if (!isProd) console.log('[io]', ...args)
}
const str = (v) => (v == null ? '' : String(v))

/* ───────────────────────────
 *  Low-level emit helper
 * ─────────────────────────── */
function emitToRoom(io, room, event, payload, { volatile = false } = {}) {
  if (!io || !room || !event) return

  const listeners = io.sockets.adapter.rooms.get(room)?.size || 0
  if (!listeners) {
    if (!isProd) log(`skip emit (no listeners) ${event} → ${room}`)
    return
  }

  const target = io.to(room)
  const emitter = volatile ? target.volatile : target
  emitter.emit(event, payload)

  log(
    `emit ${volatile ? '(volatile) ' : ''}${event} → ${room}`,
    `listeners=${listeners}`,
    `_id=${payload?._id || payload?.bookingId || ''}`
  )
}

/* ───────────────────────────
 *  Convenience: emit to admins + chef + employee
 *  (used by food module, etc.)
 * ─────────────────────────── */
function emitCounterpart(io, event, doc) {
  if (!io || !doc) return
  const empId = str(doc.employee?.employeeId || doc.employeeId || doc.employee)

  ;[
    ROOMS.ADMINS,
    ROOMS.CHEFS,
    empId && ROOMS.EMPLOYEE(empId),
  ]
    .filter(Boolean)
    .forEach((room) => emitToRoom(io, room, event, doc))
}

/* ───────────────────────────
 *  Central broadcast for CarBooking
 *  (used by transportation controllers)
 * ─────────────────────────── */
function broadcastCarBooking(io, doc, event, payload) {
  if (!io || !doc || !event) return

  const empId = str(doc.employee?.employeeId || doc.employeeId || '')
  const bookingId = str(doc._id)

  const rooms = new Set([
    ROOMS.ADMINS,                           // all transport/admin users
    ROOMS.DRIVERS,                         // NEW: all drivers online
    ROOMS.MESSENGERS,                      // NEW: all messengers online
    empId && ROOMS.EMPLOYEE(empId),        // specific requester
    bookingId && ROOMS.BOOKING(bookingId), // detail page for this booking
  ])

  for (const room of rooms) {
    if (room) emitToRoom(io, room, event, payload)
  }
}

/* ───────────────────────────
 *  Socket registration
 * ─────────────────────────── */
function registerSocket(io) {
  // Attach auth from JWT if present
  io.use((socket, next) => {
    try {
      const hdr = socket.handshake.headers?.authorization || ''
      const tokenFromHdr = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
      const token = socket.handshake.auth?.token || tokenFromHdr || ''

      if (token) {
        socket.user = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ['HS256'],
        })
      }
    } catch (e) {
      if (!isProd) log('auth fail:', e?.message)
      // we still allow connection; just no user info
    }
    next()
  })

  io.on('connection', (socket) => {
    log('connect', socket.id)
    socket.data.connectedAt = Date.now()
    socket.data.joined = new Set()

    // Basic identity from token / handshake
    const role = str(socket.user?.role || socket.handshake.auth?.role).toUpperCase()
    const employeeId = str(
      socket.handshake.auth?.employeeId || socket.handshake.query?.employeeId
    )
    const companyId = str(
      socket.user?.companyId ||
        socket.handshake.auth?.companyId ||
        socket.handshake.query?.companyId
    )

    // Auto-join default rooms based on role+identity
    if (role === 'ADMIN')     joinRoomSafe(socket, ROOMS.ADMINS)
    if (role === 'CHEF')      joinRoomSafe(socket, ROOMS.CHEFS)

    // NEW: drivers & messengers
    if (role === 'DRIVER')    joinRoomSafe(socket, ROOMS.DRIVERS)
    if (role === 'MESSENGER') joinRoomSafe(socket, ROOMS.MESSENGERS)

    if (employeeId) joinRoomSafe(socket, ROOMS.EMPLOYEE(employeeId))
    if (companyId)  joinRoomSafe(socket, ROOMS.COMPANY(companyId))

    dumpRooms(socket, 'post-handshake')

    /* ───── subscribe/unsubscribe from frontend ───── */
    socket.on('subscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)
      const denied = validateJoin(socket, p)
      if (denied) return safeAck(ack, { ok: false, error: denied })

      if (p.role === 'ADMIN')     joinRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF')      joinRoomSafe(socket, ROOMS.CHEFS)

      // NEW: allow explicit subscription by role
      if (p.role === 'DRIVER')    joinRoomSafe(socket, ROOMS.DRIVERS)
      if (p.role === 'MESSENGER') joinRoomSafe(socket, ROOMS.MESSENGERS)

      if (p.employeeId) joinRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId)  joinRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId)  joinRoomSafe(socket, ROOMS.BOOKING(p.bookingId))

      dumpRooms(socket, 'after-subscribe')
      safeAck(ack, { ok: true, rooms: listedRooms(socket) })
    })

    socket.on('unsubscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)

      if (p.role === 'ADMIN')     leaveRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF')      leaveRoomSafe(socket, ROOMS.CHEFS)

      // NEW: explicit unsubscribe by role
      if (p.role === 'DRIVER')    leaveRoomSafe(socket, ROOMS.DRIVERS)
      if (p.role === 'MESSENGER') leaveRoomSafe(socket, ROOMS.MESSENGERS)

      if (p.employeeId) leaveRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId)  leaveRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId)  leaveRoomSafe(socket, ROOMS.BOOKING(p.bookingId))

      dumpRooms(socket, 'after-unsubscribe')
      safeAck(ack, { ok: true, rooms: listedRooms(socket) })
    })

    /* ───── latency probe ───── */
    socket.on('ping:client', (ts) => {
      const rtt = Date.now() - Number(ts || Date.now())
      socket.emit('pong:server', { rtt })
    })

    /* ───── driver live location (transport) ───── */
    socket.on('driver:location', (payload = {}) => {
      const bookingId = str(payload.bookingId)
      if (!bookingId) return

      // Simple backpressure: do nothing if underlying buffer is big
      const buf = socket.conn?.transport?.bufferSize ?? 0
      if (buf > 64 * 1024) return

      emitToRoom(
        io,
        ROOMS.BOOKING(bookingId),
        'driver:location',
        {
          t: Date.now(),
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          spd: Number(payload.spd || 0),
        },
        { volatile: true }
      )
    })

    socket.on('disconnect', (reason) => log('disconnect', socket.id, reason))
  })
}

/* ───────────────────────────
 *  Debug endpoints
 * ─────────────────────────── */
function attachDebugEndpoints(app) {
  // List active rooms (excluding per-socket rooms)
  app.get('/api/_debug/rooms', (_req, res) => {
    const io = app.get('io')
    if (!io) return res.status(500).json({ ok: false, error: 'io-not-set' })

    const socketIds = new Set(io.sockets.sockets.keys())
    const rooms = []

    for (const [name, set] of io.sockets.adapter.rooms) {
      // Skip individual socket rooms
      if (socketIds.has(name)) continue
      rooms.push({ name, listeners: set.size })
    }

    res.json(rooms)
  })

  // Send a test pulse into a room
  app.get('/api/_debug/ping', (req, res) => {
    const io = app.get('io')
    if (!io) return res.status(500).json({ ok: false, error: 'io-not-set' })

    const id = str(req.query.employeeId)
    const room = id ? ROOMS.EMPLOYEE(id) : ROOMS.ADMINS

    emitToRoom(io, room, 'debug:pulse', { room, at: new Date().toISOString() })
    res.json({ ok: true, room })
  })
}

/* ───────────────────────────
 *  Internal helpers
 * ─────────────────────────── */
function joinRoomSafe(socket, room) {
  if (!room) return
  socket.join(room)
  socket.data.joined.add(room)
}

function leaveRoomSafe(socket, room) {
  if (!room) return
  socket.leave(room)
  socket.data.joined.delete(room)
}

function listedRooms(socket) {
  return [...socket.rooms].filter((r) => r !== socket.id)
}

function dumpRooms(socket, tag = '') {
  log(tag, socket.id, 'rooms=', listedRooms(socket))
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') {
    try {
      ack(payload)
    } catch (_) {}
  }
}

function normalizeSubPayload(p = {}) {
  return {
    role: str(p.role || '').toUpperCase(),
    employeeId: str(p.employeeId || ''),
    companyId: str(p.companyId || ''),
    bookingId: str(p.bookingId || ''),
  }
}

/**
 * Enforce simple access rules when joining rooms via `subscribe`
 */
function validateJoin(socket, p) {
  const role = str(socket.user?.role).toUpperCase()
  const userEmpId = str(socket.user?.employeeId)
  const userCompany = str(socket.user?.companyId)

  // Admin room: only ADMIN
  if (p.role === 'ADMIN' && role !== 'ADMIN') return 'FORBIDDEN:ADMIN_ROOM'

  // Chef room: ADMIN or CHEF
  if (p.role === 'CHEF' && !['ADMIN', 'CHEF'].includes(role)) {
    return 'FORBIDDEN:CHEF_ROOM'
  }

  // NOTE: DRIVER / MESSENGER rooms are not restricted here;
  // any authenticated socket with role DRIVER/MESSENGER will pass.

  // Employee room: ADMIN can see anyone, others only their own employeeId
  if (p.employeeId) {
    if (role !== 'ADMIN' && p.employeeId !== userEmpId) {
      return 'FORBIDDEN:EMPLOYEE_ROOM'
    }
  }

  // Company room: ADMIN can see any, others only their own company
  if (p.companyId) {
    if (role !== 'ADMIN' && p.companyId !== userCompany) {
      return 'FORBIDDEN:COMPANY_ROOM'
    }
  }

  // Booking room: currently no extra checks
  return ''
}

/* ───────────────────────────
 *  Exports
 * ─────────────────────────── */
module.exports = {
  ROOMS,
  emitToRoom,
  emitCounterpart,
  broadcastCarBooking,
  registerSocket,
  attachDebugEndpoints,
}
