// backend/server.js
require('dotenv').config()

const http       = require('http')
const express    = require('express')
const mongoose   = require('mongoose')
const cors       = require('cors')
const helmet     = require('helmet')
const rateLimit  = require('express-rate-limit')
const { Server } = require('socket.io')

const { registerSocket, attachDebugEndpoints } = require('./utils/realtime')

const app = express()

/* --- CORS origins --- */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use(helmet())
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(rateLimit({ windowMs: 60_000, max: 200 }))

app.get('/', (_req, res) => res.send('API running...'))

// attach io on req for controllers
app.use((req, _res, next) => { req.io = app.get('io'); next() })

/* --- Routes --- */
app.use('/api/auth',   require('./routes/auth.routes'))
app.use('/api/public', require('./routes/public-directory.routes'))
app.use('/api/public', require('./routes/food-public.routes'))
app.use('/api/admin',  require('./routes/food-admin.routes'))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: err.message || 'Server error' })
})

/* --- HTTP + Socket.IO --- */
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : ['http://localhost:5173'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: true }
})

registerSocket(io)
app.set('io', io)
attachDebugEndpoints(app)

/* --- Boot --- */
const PORT = process.env.PORT || 4333

mongoose.connect(process.env.MONGO_URI, {})
  .then(() => {
    console.log('MongoDB connected')
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
  })
  .catch(err => console.error(err))
