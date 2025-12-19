// backend/server.js
require('dotenv').config()

const http        = require('http')
const path        = require('path')
const express     = require('express')
const mongoose    = require('mongoose')
const cors        = require('cors')
const helmet      = require('helmet')
const compression = require('compression')
const rateLimit   = require('express-rate-limit')
const { Server }  = require('socket.io')

const { startTelegramPolling, stopTelegramPolling } = require('./services/telegram.polling')
const { registerSocket, attachDebugEndpoints } = require('./utils/realtime')
const { startRecurringEngine } = require('./services/recurring.engine')

const app = express()

const POLLING_ENABLED =
  String(process.env.TELEGRAM_POLLING_ENABLED || 'false').toLowerCase() === 'true'

if (POLLING_ENABLED) {
  startTelegramPolling()
  console.log('✅ Telegram polling enabled')
} else {
  console.log('ℹ️ Telegram polling disabled')
}


/* ───────────────── Env & toggles ───────────────── */
const isProd     = String(process.env.NODE_ENV).toLowerCase() === 'production'
const forceHTTPS = String(process.env.FORCE_HTTPS || '').toLowerCase() === 'true'
if (isProd) app.set('trust proxy', 1)

/* ───────────────── CORS ───────────────── */
const rawOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const hasWildcard = rawOrigins.includes('*')
const apiCorsOptions = hasWildcard
  ? { origin: true, credentials: false }
  : { origin: rawOrigins, credentials: true }

/* ───────────────── HTTPS redirect (if enabled) ───────────────── */
if (forceHTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next()
    const host = req.headers.host
    return res.redirect(301, `https://${host}${req.originalUrl}`)
  })
}

/* ───────────────── Security & Perf ───────────────── */
app.use(helmet({
  hsts: forceHTTPS,
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

if (!forceHTTPS) {
  app.use((_, res, next) => { res.removeHeader('Strict-Transport-Security'); next() })
}

app.use(cors(apiCorsOptions))
app.use(compression())

/* ───────────────── Parsers & Limits ───────────────── */
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ limit: '5mb', extended: true }))

/* ───────────────── Health ───────────────── */
app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.get('/api/health', (_req, res) => res.send('✅ API running'))

/* ───────────────── Basic rate limit on API ───────────────── */
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}))

/* ───────────────── Attach io onto req (for controllers) ───────────────── */
app.use((req, _res, next) => { req.io = app.get('io'); next() })

/* ───────────────── Routes ───────────────── */

//========================== ADMIN PANEL (Leave module) ===========================
app.use('/api/leave/requests', require('./routes/leave/leave.routes'))
app.use('/api/leave',          require('./routes/leave/leaveType-expat.routes'))
app.use('/api/leave/profile',  require('./routes/leave/leaveProfile.routes'))
app.use('/api/leave/replace-days', require('./routes/leave/replaceDay.routes'))

// ✅ admin leave routes grouped
app.use('/api/admin/leave', require('./routes/leave/leaveAdmin.routes'))
app.use('/api/admin/leave/year-sheets', require('./routes/leave/leaveYearSheet-admin.routes'))
app.use('/api/admin/leave/types',       require('./routes/leave/leaveType-admin.routes'))


// Auth
app.use('/api/auth', require('./routes/auth.routes'))

// ========================== Public ================================
app.use('/api/public', require('./routes/public-directory.routes'))
app.use('/api/public', require('./routes/food/food-public.routes'))

// =========================== Food ==================================
app.use('/api/admin', require('./routes/food/food-admin.routes'))
app.use('/api/chef/food-requests', require('./routes/food/food-chef.routes'))

// Static uploads
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || 'uploads')))

// ============================== Transportation ===========================
app.use('/api/car-bookings', require('./routes/transportation/carBooking.routes'))
app.use('/api/public/car-bookings', require('./routes/transportation/carBooking.routes'))

app.use('/api/admin/car-bookings', require('./routes/transportation/carBooking-admin.routes'))
app.use('/api/admin', require('./routes/admin-user.routes'))

app.use('/api/driver', require('./routes/transportation/carBooking-driver.routes'))
app.use('/api/messenger', require('./routes/transportation/carBooking-messenger.routes'))
app.use('/api/messenger/car-bookings', require('./routes/transportation/carBooking-messenger.routes'))

app.use('/api/transport/recurring', require('./routes/transportation/carBooking-recurring.routes'))
app.use('/api/public/transport', require('./routes/transportation/carBooking.public.routes'))

// ====================================== Holiday =================================
app.use('/api/public', require('./routes/public-holidays.routes'))

/* ───────────────── 404 for API ───────────────── */
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }))

/* ───────────────── Error handler ───────────────── */
app.use((err, _req, res, _next) => {
  if (!isProd) console.error(err)
  res.status(err.status || 500).json({
    message: err.message || 'Server error',
    ...(!isProd && { stack: err.stack }),
  })
})

/* ───────────────── Static SPA (optional) ───────────────── */
const frontendDir = process.env.FRONTEND_DIR
if (frontendDir) {
  const distPath = path.resolve(frontendDir)
  app.use(express.static(distPath))
  app.get(/^\/(?!socket\.io\/).*/, (_req, res) =>
    res.sendFile(path.join(distPath, 'index.html'))
  )
}

/* ───────────────── HTTP + Socket.IO ───────────────── */
const server = http.createServer(app)

const ioCors = hasWildcard
  ? { origin: true, methods: ['GET', 'POST'] }
  : { origin: rawOrigins, methods: ['GET', 'POST'], credentials: true }

const io = new Server(server, {
  cors: ioCors,
  transports: ['websocket'],
  perMessageDeflate: { threshold: 1024 },
  maxHttpBufferSize: 1 * 1024 * 1024,
  pingInterval: 25_000,
  pingTimeout: 60_000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  },
})

registerSocket(io)
app.set('io', io)
attachDebugEndpoints(app)

/* ───────────────── Boot ───────────────── */
const PORT = Number(process.env.PORT || 4333)

;(async function boot() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })
    console.log('✅ MongoDB connected')

    server.listen(PORT, () => {
      const proto = forceHTTPS ? 'https' : 'http'
      console.log(`🚀 Server listening on ${proto}://0.0.0.0:${PORT}`)
    })

    const stopRecurring = startRecurringEngine(io)

    const shutdown = async (sig) => {
      console.log(`\n${sig} received. Shutting down...`)
      try { stopRecurring && stopRecurring() } catch (_) {}

      // ✅ stop telegram polling cleanly (prevents 409 after restart)
      try { await stopTelegramPolling() } catch (_) {}

      server.close(() => console.log('HTTP server closed'))
      try { await mongoose.connection.close() } catch (_) {}
      process.exit(0)
    }

    process.on('SIGINT',  () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  } catch (err) {
    console.error('❌ Startup error:', err)
    process.exit(1)
  }
})()
