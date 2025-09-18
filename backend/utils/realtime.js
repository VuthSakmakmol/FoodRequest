// backend/utils/realtime.js
const jwt = require('jsonwebtoken')

/* ------------ helpers ------------ */
const empRoom = (id) => `employee:${String(id)}`

function emitToRoom(io, room, event, payload) {
  if (!io) return
  const listeners = io.sockets.adapter.rooms.get(room)?.size || 0
  console.log(`[io emit] ${event} → ${room} listeners=${listeners} _id=${payload?._id || ''}`)
  io.to(room).emit(event, payload)
}

function emitCounterpart(io, event, doc) {
  if (!io || !doc) return
  const rooms = ['admins', 'chefs', empRoom(doc.employee?.employeeId)]
  rooms.forEach((r) => emitToRoom(io, r, event, doc))
}

/* ------------ socket registration ------------ */
function registerSocket(io) {
  io.use((socket, next) => {
    try {
      const hdr = socket.handshake.headers?.authorization || ''
      const tokenFromHdr = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
      const token = socket.handshake.auth?.token || tokenFromHdr || ''
      if (token) socket.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    } catch (_) {}
    next()
  })

  io.on('connection', (socket) => {
    const logRooms = (tag = '') => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id)
      console.log(`[io] ${tag} ${socket.id} rooms=`, rooms)
    }

    console.log('[io] connect', socket.id)

    // default joins from handshake
    const role = socket.user?.role || socket.handshake.auth?.role || ''
    const employeeId = socket.handshake.auth?.employeeId || socket.handshake.query?.employeeId || ''

    if (role === 'ADMIN') socket.join('admins')
    if (role === 'CHEF') socket.join('chefs')
    if (employeeId) socket.join(empRoom(employeeId))

    logRooms('post-handshake')

    // subscribe/unsubscribe at runtime
    socket.on('subscribe', (payload = {}, ack) => {
      const emp = payload.employeeId ? String(payload.employeeId) : ''
      if (payload.role === 'ADMIN') socket.join('admins')
      if (payload.role === 'CHEF') socket.join('chefs')
      if (emp) socket.join(empRoom(emp))
      logRooms('after-subscribe')
      if (typeof ack === 'function') ack({ ok: true, rooms: [...socket.rooms] })
    })

    socket.on('unsubscribe', (payload = {}, ack) => {
      const emp = payload.employeeId ? String(payload.employeeId) : ''
      if (payload.role === 'ADMIN') socket.leave('admins')
      if (payload.role === 'CHEF') socket.leave('chefs')
      if (emp) socket.leave(empRoom(emp))
      logRooms('after-unsubscribe')
      if (typeof ack === 'function') ack({ ok: true, rooms: [...socket.rooms] })
    })

    socket.on('disconnect', (r) => console.log('[io] disconnect', socket.id, r))
  })
}

/* ------------ tiny debug helpers ------------ */
function attachDebugEndpoints(app) {
  app.get('/api/_debug/rooms', (_req, res) => {
    const rooms = []
    for (const [name, set] of app.get('io').sockets.adapter.rooms) {
      rooms.push({ name, listeners: set.size })
    }
    res.json(rooms)
  })

  app.get('/api/_debug/ping', (req, res) => {
    const id = String(req.query.employeeId || '')
    const room = id ? empRoom(id) : 'admins'
    emitToRoom(app.get('io'), room, 'debug:pulse', { room, at: new Date().toISOString() })
    res.json({ ok: true, room })
  })
}

module.exports = {
  empRoom,
  emitToRoom,
  emitCounterpart,
  registerSocket,
  attachDebugEndpoints,
}
