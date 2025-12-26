// backend/utils/realtime.js
const jwt = require('jsonwebtoken')

/* ───────────────────────────
 * Room naming helpers
 * ─────────────────────────── */
const clean = (v) => (v == null ? '' : String(v).trim())
const upper = (v) => clean(v).toUpperCase()

const ROOMS = {
  ADMINS: 'admins',
  CHEFS: 'chefs',

  DRIVERS: 'drivers',
  MESSENGERS: 'messengers',

  ROLE: (code) => `role:${upper(code)}`,

  EMPLOYEE: (id) => `employee:${clean(id)}`,
  COMPANY: (id) => `company:${clean(id)}`,
  BOOKING: (id) => `booking:${clean(id)}`,

  USER: (loginId) => `user:${clean(loginId)}`,
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const log = (...args) => {
  if (!isProd) console.log('[io]', ...args)
}

/* ───────────────────────────
 * Multi-role helpers
 * ─────────────────────────── */
function rolesFromUser(user) {
  const raw = Array.isArray(user?.roles) ? user.roles : []
  const one = user?.role ? [user.role] : []
  return [...new Set([...raw, ...one].map((r) => upper(r)).filter(Boolean))]
}

function hasAny(roles, ...allow) {
  const set = new Set((roles || []).map((r) => upper(r)))
  return allow.some((r) => set.has(upper(r)))
}

function isAdminLike(roles) {
  // ✅ who can listen to ADMINS room
  return hasAny(roles, 'ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN')
}

/* ───────────────────────────
 * Low-level emit helper
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

  if (!isProd) {
    log(
      `emit ${volatile ? '(volatile) ' : ''}${event} → ${room}`,
      `listeners=${listeners}`,
      `_id=${payload?._id || payload?.bookingId || ''}`
    )
  }
}

/* ───────────────────────────
 * Convenience: emit to admins + chef + employee
 * ─────────────────────────── */
function emitCounterpart(io, event, doc) {
  if (!io || !doc) return
  const empId = clean(doc.employee?.employeeId || doc.employeeId || doc.employee)

  ;[ROOMS.ADMINS, ROOMS.CHEFS, empId && ROOMS.EMPLOYEE(empId)]
    .filter(Boolean)
    .forEach((room) => emitToRoom(io, room, event, doc))
}

/* ───────────────────────────
 * Central broadcast for CarBooking
 * ─────────────────────────── */
function broadcastCarBooking(io, doc, event, payload) {
  if (!io || !doc || !event) return

  const empId = clean(doc.employee?.employeeId || doc.employeeId || '')
  const bookingId = clean(doc._id)

  const rooms = new Set([
    ROOMS.ADMINS,
    ROOMS.DRIVERS,
    ROOMS.MESSENGERS,
    empId && ROOMS.EMPLOYEE(empId),
    bookingId && ROOMS.BOOKING(bookingId),
  ])

  for (const room of rooms) {
    if (!room) continue
    emitToRoom(io, room, event, payload || (doc.toObject ? doc.toObject() : doc))
  }
}

/* ───────────────────────────
 * Socket registration
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
        if (!socket.user.role && socket.user.roles.length) {
          socket.user.role = socket.user.roles[0]
        }
      }
    } catch (e) {
      if (!isProd) log('auth fail:', e?.message)
      // allow connection without user info
    }
    next()
  })

  io.on('connection', (socket) => {
    log('connect', socket.id)
    socket.data.connectedAt = Date.now()
    socket.data.joined = new Set()

    const roles = rolesFromUser(socket.user)

    // Identity (prefer token; fall back to handshake)
    const loginId = clean(
      socket.user?.loginId ||
        socket.user?.id || // sometimes JWT uses id as loginId
        socket.handshake.auth?.loginId ||
        socket.handshake.query?.loginId
    )

    const employeeId = clean(
      socket.user?.employeeId ||
        socket.handshake.auth?.employeeId ||
        socket.handshake.query?.employeeId ||
        loginId // your system often uses employeeId == loginId
    )

    const companyId = clean(
      socket.user?.companyId ||
        socket.handshake.auth?.companyId ||
        socket.handshake.query?.companyId
    )

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

    // scoped
    if (employeeId) joinRoomSafe(socket, ROOMS.EMPLOYEE(employeeId))
    if (companyId) joinRoomSafe(socket, ROOMS.COMPANY(companyId))

    // ✅ IMPORTANT FIX: auto-join own personal room
    // This makes Leave inbox realtime reliable without extra frontend subscribe.
    if (loginId) joinRoomSafe(socket, ROOMS.USER(loginId))
    // also join employeeId as user-room if they differ (common in your app)
    if (employeeId && employeeId !== loginId) joinRoomSafe(socket, ROOMS.USER(employeeId))

    dumpRooms(socket, 'post-handshake')

    /* ───── subscribe/unsubscribe from frontend ───── */
    socket.on('subscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)
      const denied = validateJoin(socket, p)
      if (denied) return safeAck(ack, { ok: false, error: denied })

      // Shared rooms
      if (['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN'].includes(p.role)) joinRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF') joinRoomSafe(socket, ROOMS.CHEFS)
      if (p.role === 'DRIVER') joinRoomSafe(socket, ROOMS.DRIVERS)
      if (p.role === 'MESSENGER') joinRoomSafe(socket, ROOMS.MESSENGERS)

      // ✅ Generic role room
      if (
        p.role &&
        !['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN', 'CHEF', 'DRIVER', 'MESSENGER'].includes(p.role)
      ) {
        joinRoomSafe(socket, ROOMS.ROLE(p.role))
      }

      // Scoped rooms
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

      if (
        p.role &&
        !['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN', 'CHEF', 'DRIVER', 'MESSENGER'].includes(p.role)
      ) {
        leaveRoomSafe(socket, ROOMS.ROLE(p.role))
      }

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
      const bookingId = clean(payload.bookingId)
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
 * Debug endpoints
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

    const id = clean(req.query.employeeId)
    const room = id ? ROOMS.EMPLOYEE(id) : ROOMS.ADMINS

    emitToRoom(io, room, 'debug:pulse', { room, at: new Date().toISOString() })
    res.json({ ok: true, room })
  })
}

/* ───────────────────────────
 * Internal helpers
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
    role: upper(p.role || ''),
    employeeId: clean(p.employeeId || ''),
    companyId: clean(p.companyId || ''),
    bookingId: clean(p.bookingId || ''),
    loginId: clean(p.loginId || ''),
  }
}

/**
 * Enforce access rules when joining rooms via `subscribe`
 */
function validateJoin(socket, p) {
  const roles = rolesFromUser(socket.user)
  const adminLike = isAdminLike(roles)

  const userEmpId =
    clean(socket.user?.employeeId) ||
    clean(socket.handshake.auth?.employeeId) ||
    ''

  const userCompany =
    clean(socket.user?.companyId) || ''

  // IMPORTANT: your JWT may store loginId in different fields
  const userLoginId =
    clean(socket.user?.loginId) ||
    clean(socket.user?.id) ||
    clean(socket.handshake.auth?.loginId) ||
    userEmpId

  // Admin room
  if (p.role && ['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN'].includes(p.role)) {
    if (!adminLike) return 'FORBIDDEN:ADMIN_ROOM'
  }

  // Chef/Driver/Messenger rooms
  if (p.role === 'CHEF' && !(adminLike || hasAny(roles, 'CHEF'))) return 'FORBIDDEN:CHEF_ROOM'
  if (p.role === 'DRIVER' && !(adminLike || hasAny(roles, 'DRIVER'))) return 'FORBIDDEN:DRIVER_ROOM'
  if (p.role === 'MESSENGER' && !(adminLike || hasAny(roles, 'MESSENGER'))) return 'FORBIDDEN:MESSENGER_ROOM'

  // Generic role room
  if (
    p.role &&
    !['ADMIN', 'ROOT_ADMIN', 'LEAVE_ADMIN', 'CHEF', 'DRIVER', 'MESSENGER'].includes(p.role)
  ) {
    if (!(adminLike || hasAny(roles, p.role))) return 'FORBIDDEN:ROLE_ROOM'
  }

  // Employee room: admin-like can see anyone, others only self
  if (p.employeeId) {
    if (!adminLike && p.employeeId !== userEmpId && p.employeeId !== userLoginId) {
      return 'FORBIDDEN:EMPLOYEE_ROOM'
    }
  }

  // Company room: admin-like can see any, others only their own company
  if (p.companyId) {
    if (!adminLike && p.companyId !== userCompany) return 'FORBIDDEN:COMPANY_ROOM'
  }

  // ✅ USER room: allow self by loginId OR employeeId (your system mixes them)
  if (p.loginId) {
    if (!adminLike && p.loginId !== userLoginId && p.loginId !== userEmpId) {
      return 'FORBIDDEN:USER_ROOM'
    }
  }

  return ''
}

/* ───────────────────────────
 * Exports
 * ─────────────────────────── */
module.exports = {
  ROOMS,
  emitToRoom,
  emitCounterpart,
  broadcastCarBooking,
  registerSocket,
  attachDebugEndpoints,
}
