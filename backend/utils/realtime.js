// backend/utils/realtime.js
const jwt = require('jsonwebtoken')

/* ───────────────────────────
 *  Room naming helpers
 * ─────────────────────────── */
const ROOMS = {
  ADMINS: 'admins',
  CHEFS: 'chefs',

  // role-wide rooms for transportation
  DRIVERS: 'drivers',
  MESSENGERS: 'messengers',

  EMPLOYEE: (id) => `employee:${String(id)}`,
  COMPANY: (id) => `company:${String(id)}`,
  BOOKING: (id) => `booking:${String(id)}`,

  // per-loginId room, used by leave module etc.
  USER: (loginId) => `user:${String(loginId)}`,
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const log = (...args) => {
  if (!isProd) console.log('[io]', ...args)
}
const str = (v) => (v == null ? '' : String(v))

/* ───────────────────────────
 *  Multi-role helpers
 * ─────────────────────────── */
function rolesFromUser(user) {
  const raw = Array.isArray(user?.roles) ? user.roles : []
  const one = user?.role ? [user.role] : []
  return [...new Set([...raw, ...one].map((r) => String(r || '').toUpperCase()))]
}

function hasAny(roles, ...allow) {
  const set = new Set(roles || [])
  return allow.some((r) => set.has(String(r || '').toUpperCase()))
}

function isAdminLike(roles) {
  // ✅ treat leave admin as admin-room listener (so leave broadcasts reach them)
  return hasAny(roles, 'ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN')
}

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
 * ─────────────────────────── */
function emitCounterpart(io, event, doc) {
  if (!io || !doc) return
  const empId = str(doc.employee?.employeeId || doc.employeeId || doc.employee)

  ;[ROOMS.ADMINS, ROOMS.CHEFS, empId && ROOMS.EMPLOYEE(empId)]
    .filter(Boolean)
    .forEach((room) => emitToRoom(io, room, event, doc))
}

/* ───────────────────────────
 *  Central broadcast for CarBooking
 * ─────────────────────────── */
function broadcastCarBooking(io, doc, event, payload) {
  if (!io || !doc || !event) return

  const empId = str(doc.employee?.employeeId || doc.employeeId || '')
  const bookingId = str(doc._id)

  const rooms = new Set([
    ROOMS.ADMINS,
    ROOMS.DRIVERS,
    ROOMS.MESSENGERS,
    empId && ROOMS.EMPLOYEE(empId),
    bookingId && ROOMS.BOOKING(bookingId),
  ])

  for (const room of rooms) {
    if (room) emitToRoom(io, room, event, payload || (doc.toObject ? doc.toObject() : doc))
  }
}

/* ───────────────────────────
 *  Central broadcast for LeaveRequest
 * ─────────────────────────── */
function broadcastLeaveRequest(io, doc, event, payload) {
  if (!io || !doc || !event) return

  const employeeId = str(doc.employeeId || '')
  const requesterLogin = str(doc.requesterLoginId || '')
  const managerLoginId = str(doc.managerLoginId || '')
  const gmLoginId = str(doc.gmLoginId || '')

  const body = payload || (doc.toObject ? doc.toObject() : doc)

  log('leave:broadcast', event, {
    id: body._id,
    employeeId,
    requesterLogin,
    managerLoginId,
    gmLoginId,
  })

  const rooms = new Set([
    ROOMS.ADMINS, // ✅ leave admins should be in here now
    employeeId && ROOMS.EMPLOYEE(employeeId),
    requesterLogin && ROOMS.USER(requesterLogin),
    managerLoginId && ROOMS.USER(managerLoginId),
    gmLoginId && ROOMS.USER(gmLoginId),
  ])

  for (const room of rooms) {
    if (room) emitToRoom(io, room, event, body)
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

        // ✅ normalize roles from JWT
        socket.user.roles = rolesFromUser(socket.user)
        if (!socket.user.role && socket.user.roles.length) socket.user.role = socket.user.roles[0]
      }
    } catch (e) {
      if (!isProd) log('auth fail:', e?.message)
      // allow connection, but no user info
    }
    next()
  })

  io.on('connection', (socket) => {
    log('connect', socket.id)
    socket.data.connectedAt = Date.now()
    socket.data.joined = new Set()

    const roles = rolesFromUser(socket.user)

    // Basic identity from token / handshake
    const employeeId = str(
      socket.handshake.auth?.employeeId ||
        socket.handshake.query?.employeeId ||
        socket.user?.employeeId
    )
    const companyId = str(
      socket.user?.companyId ||
        socket.handshake.auth?.companyId ||
        socket.handshake.query?.companyId
    )

    // ✅ use id/loginId
    const loginId = str(socket.user?.id || socket.user?.loginId || socket.handshake.auth?.loginId)

    log('SOCKET IDENTITY', {
      socketId: socket.id,
      roles,
      employeeId,
      companyId,
      loginId,
    })

    // Auto-join default rooms based on multi-role
    if (isAdminLike(roles)) joinRoomSafe(socket, ROOMS.ADMINS)
    if (hasAny(roles, 'CHEF')) joinRoomSafe(socket, ROOMS.CHEFS)
    if (hasAny(roles, 'DRIVER')) joinRoomSafe(socket, ROOMS.DRIVERS)
    if (hasAny(roles, 'MESSENGER')) joinRoomSafe(socket, ROOMS.MESSENGERS)

    if (employeeId) joinRoomSafe(socket, ROOMS.EMPLOYEE(employeeId))
    if (companyId) joinRoomSafe(socket, ROOMS.COMPANY(companyId))

    // personal user room (loginId) for leave module
    if (loginId) joinRoomSafe(socket, ROOMS.USER(loginId))

    dumpRooms(socket, 'post-handshake')

    /* ───── subscribe/unsubscribe from frontend ───── */
    socket.on('subscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)
      const denied = validateJoin(socket, p)
      if (denied) return safeAck(ack, { ok: false, error: denied })

      // ✅ admin-like roles subscribe to admin room too
      if (['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN'].includes(p.role)) joinRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF') joinRoomSafe(socket, ROOMS.CHEFS)
      if (p.role === 'DRIVER') joinRoomSafe(socket, ROOMS.DRIVERS)
      if (p.role === 'MESSENGER') joinRoomSafe(socket, ROOMS.MESSENGERS)

      if (p.employeeId) joinRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId) joinRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId) joinRoomSafe(socket, ROOMS.BOOKING(p.bookingId))
      if (p.loginId) joinRoomSafe(socket, ROOMS.USER(p.loginId))

      dumpRooms(socket, 'after-subscribe')
      safeAck(ack, { ok: true, rooms: listedRooms(socket) })
    })

    socket.on('unsubscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)

      if (['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN'].includes(p.role)) leaveRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF') leaveRoomSafe(socket, ROOMS.CHEFS)
      if (p.role === 'DRIVER') leaveRoomSafe(socket, ROOMS.DRIVERS)
      if (p.role === 'MESSENGER') leaveRoomSafe(socket, ROOMS.MESSENGERS)

      if (p.employeeId) leaveRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId) leaveRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId) leaveRoomSafe(socket, ROOMS.BOOKING(p.bookingId))
      if (p.loginId) leaveRoomSafe(socket, ROOMS.USER(p.loginId))

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
  app.get('/api/_debug/rooms', (_req, res) => {
    const io = app.get('io')
    if (!io) return res.status(500).json({ ok: false, error: 'io-not-set' })

    const socketIds = new Set(io.sockets.sockets.keys())
    const rooms = []

    for (const [name, set] of io.sockets.adapter.rooms) {
      if (socketIds.has(name)) continue
      rooms.push({ name, listeners: set.size })
    }

    res.json(rooms)
  })

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
    loginId: str(p.loginId || ''),
  }
}

/**
 * Enforce simple access rules when joining rooms via `subscribe`
 */
function validateJoin(socket, p) {
  const roles = rolesFromUser(socket.user)

  const userEmpId = str(socket.user?.employeeId)
  const userCompany = str(socket.user?.companyId)
  const userLoginId = str(socket.user?.id || socket.user?.loginId)

  const adminLike = isAdminLike(roles)

  // Admin room: only admin-like
  if (p.role && ['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN'].includes(p.role)) {
    if (!adminLike) return 'FORBIDDEN:ADMIN_ROOM'
  }

  // Chef room: admin-like or chef
  if (p.role === 'CHEF' && !(adminLike || hasAny(roles, 'CHEF'))) {
    return 'FORBIDDEN:CHEF_ROOM'
  }

  // Driver room: admin-like or driver
  if (p.role === 'DRIVER' && !(adminLike || hasAny(roles, 'DRIVER'))) {
    return 'FORBIDDEN:DRIVER_ROOM'
  }

  // Messenger room: admin-like or messenger
  if (p.role === 'MESSENGER' && !(adminLike || hasAny(roles, 'MESSENGER'))) {
    return 'FORBIDDEN:MESSENGER_ROOM'
  }

  // Employee room: admin-like can see anyone, others only their own employeeId
  if (p.employeeId) {
    if (!adminLike && p.employeeId !== userEmpId) {
      return 'FORBIDDEN:EMPLOYEE_ROOM'
    }
  }

  // Company room: admin-like can see any, others only their own company
  if (p.companyId) {
    if (!adminLike && p.companyId !== userCompany) {
      return 'FORBIDDEN:COMPANY_ROOM'
    }
  }

  // User room: admin-like can see anyone, others only themselves
  if (p.loginId) {
    if (!adminLike && p.loginId !== userLoginId) {
      return 'FORBIDDEN:USER_ROOM'
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
  broadcastLeaveRequest,
  registerSocket,
  attachDebugEndpoints,
}
