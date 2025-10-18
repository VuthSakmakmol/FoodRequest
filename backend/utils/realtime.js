// backend/utils/realtime.js
const jwt = require('jsonwebtoken')

/* ================= helpers & constants ================= */
const ROOMS = {
  ADMINS: 'admins',
  CHEFS: 'chefs',
  EMPLOYEE: (id) => `employee:${String(id)}`,
  COMPANY: (id)  => `company:${String(id)}`,
  BOOKING: (id)  => `booking:${String(id)}`
}

const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production'
const log = (...a) => { if (!isProd) console.log('[io]', ...a) }

/** safe string */
const str = (v) => (v == null ? '' : String(v))

/** fast, safe emit with optional volatile (for high-rate streams) */
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
  log(`emit ${volatile ? '(volatile) ' : ''}${event} → ${room} listeners=${listeners} _id=${payload?._id || ''}`)
}

/** broadcast to relevant counterpart rooms for a “request”-like doc */
function emitCounterpart(io, event, doc) {
  if (!io || !doc) return
  const empId = str(doc.employee?.employeeId || doc.employeeId || doc.employee)
  ;[ROOMS.ADMINS, ROOMS.CHEFS, empId && ROOMS.EMPLOYEE(empId)]
    .filter(Boolean)
    .forEach((r) => emitToRoom(io, r, event, doc))
}

/* ================= socket registration ================= */
function registerSocket(io) {
  // 1) Auth middleware (optional/soft)
  io.use((socket, next) => {
    try {
      const hdr = socket.handshake.headers?.authorization || ''
      const tokenFromHdr = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
      const token = socket.handshake.auth?.token || tokenFromHdr || ''
      if (token) {
        // NOTE: add audience/issuer if you use them
        socket.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
      }
    } catch (e) {
      // keep unauthenticated but limit what they can join later
      if (!isProd) log('auth fail:', e?.message)
    }
    next()
  })

  // 2) Connection lifecycle
  io.on('connection', (socket) => {
    log('connect', socket.id)

    // Attach small state
    socket.data.connectedAt = Date.now()
    socket.data.joined = new Set()

    const role = str(socket.user?.role || socket.handshake.auth?.role)
    const employeeId = str(
      socket.handshake.auth?.employeeId ||
      socket.handshake.query?.employeeId
    )
    const companyId = str(
      socket.user?.companyId ||
      socket.handshake.auth?.companyId ||
      socket.handshake.query?.companyId
    )

    // Default joins based on handshake
    if (role === 'ADMIN')    joinRoomSafe(socket, ROOMS.ADMINS)
    if (role === 'CHEF')     joinRoomSafe(socket, ROOMS.CHEFS)
    if (employeeId)          joinRoomSafe(socket, ROOMS.EMPLOYEE(employeeId))
    if (companyId)           joinRoomSafe(socket, ROOMS.COMPANY(companyId))

    dumpRooms(socket, 'post-handshake')

    // 3) Controlled subscribe/unsubscribe (with basic validation)
    socket.on('subscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)
      const denied = validateJoin(socket, p)
      if (denied) return safeAck(ack, { ok: false, error: denied })

      if (p.role === 'ADMIN') joinRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF')  joinRoomSafe(socket, ROOMS.CHEFS)
      if (p.employeeId)       joinRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId)        joinRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId)        joinRoomSafe(socket, ROOMS.BOOKING(p.bookingId))

      dumpRooms(socket, 'after-subscribe')
      safeAck(ack, { ok: true, rooms: listedRooms(socket) })
    })

    socket.on('unsubscribe', (payload = {}, ack) => {
      const p = normalizeSubPayload(payload)
      if (p.role === 'ADMIN') leaveRoomSafe(socket, ROOMS.ADMINS)
      if (p.role === 'CHEF')  leaveRoomSafe(socket, ROOMS.CHEFS)
      if (p.employeeId)       leaveRoomSafe(socket, ROOMS.EMPLOYEE(p.employeeId))
      if (p.companyId)        leaveRoomSafe(socket, ROOMS.COMPANY(p.companyId))
      if (p.bookingId)        leaveRoomSafe(socket, ROOMS.BOOKING(p.bookingId))
      dumpRooms(socket, 'after-unsubscribe')
      safeAck(ack, { ok: true, rooms: listedRooms(socket) })
    })

    // 4) Lightweight RTT probe (optional UI badge)
    socket.on('ping:client', (ts) => {
      const rtt = Date.now() - Number(ts || Date.now())
      socket.emit('pong:server', { rtt })
    })

    // 5) Example: high-rate GPS stream → volatile broadcast w/ backpressure
    socket.on('driver:location', (payload = {}) => {
      const bookingId = str(payload.bookingId)
      if (!bookingId) return
      // Basic pressure check: if buffer is large, don’t forward (volatile will also drop)
      const buf = socket.conn?.transport?.writable && socket.conn?.transport?.bufferSize || 0
      if (buf > 64 * 1024) return
      emitToRoom(io, ROOMS.BOOKING(bookingId), 'driver:location', {
        t: Date.now(),
        lat: Number(payload.lat),
        lng: Number(payload.lng),
        spd: Number(payload.spd || 0)
      }, { volatile: true })
    })

    socket.on('disconnect', (reason) => log('disconnect', socket.id, reason))
  })
}

/* ================= debug endpoints ================= */
function attachDebugEndpoints(app) {
  app.get('/api/_debug/rooms', (_req, res) => {
    const io = app.get('io')
    if (!io) return res.status(500).json({ ok: false, error: 'io-not-set' })

    const socketIds = new Set(io.sockets.sockets.keys())
    const rooms = []
    for (const [name, set] of io.sockets.adapter.rooms) {
      // filter out the auto-rooms that equal a socket.id
      if (socketIds.has(name)) continue
      rooms.push({ name, listeners: set.size })
    }
    res.json(rooms)
  })

  app.get('/api/_debug/ping', (req, res) => {
    const io = app.get('io')
    if (!io) return res.status(500).json({ ok: false, error: 'io-not-set' })
    const id   = str(req.query.employeeId)
    const room = id ? ROOMS.EMPLOYEE(id) : ROOMS.ADMINS
    emitToRoom(io, room, 'debug:pulse', { room, at: new Date().toISOString() })
    res.json({ ok: true, room })
  })
}

/* ================= small utilities ================= */
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
  if (typeof ack === 'function') try { ack(payload) } catch (_) {}
}
function normalizeSubPayload(p = {}) {
  return {
    role: str(p.role || ''),
    employeeId: str(p.employeeId || ''),
    companyId: str(p.companyId || ''),
    bookingId: str(p.bookingId || '')
  }
}

/**
 * Basic authorization for joining rooms dynamically.
 * Customize as needed:
 *  - Only ADMIN can join ADMINS
 *  - CHEF or ADMIN can join CHEFS
 *  - A user may join their own employee room; ADMIN can join any
 *  - Company scoping allowed if user.companyId matches (or ADMIN)
 *  - Booking rooms allowed for related company (or ADMIN)
 */
function validateJoin(socket, p) {
  const role = str(socket.user?.role)
  const userEmpId = str(socket.user?.employeeId)
  const userCompany = str(socket.user?.companyId)

  if (p.role === 'ADMIN' && role !== 'ADMIN') return 'FORBIDDEN:ADMIN_ROOM'
  if (p.role === 'CHEF' && !['ADMIN', 'CHEF'].includes(role)) return 'FORBIDDEN:CHEF_ROOM'

  if (p.employeeId) {
    if (role !== 'ADMIN' && p.employeeId !== userEmpId) return 'FORBIDDEN:EMPLOYEE_ROOM'
  }
  if (p.companyId) {
    if (role !== 'ADMIN' && p.companyId !== userCompany) return 'FORBIDDEN:COMPANY_ROOM'
  }
  // booking rule: allow ADMIN, or same company
  if (p.bookingId && role !== 'ADMIN') {
    // If you store booking→company mapping at runtime, enforce here.
    // For now we just allow; replace with a lookup if needed.
  }
  return '' // ok
}

module.exports = {
  ROOMS,
  emitToRoom,
  emitCounterpart,
  registerSocket,
  attachDebugEndpoints,
}
