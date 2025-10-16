// backend/server.js
require('dotenv').config();

const http        = require('http');
const path        = require('path');
const express     = require('express');
const mongoose    = require('mongoose');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { Server }  = require('socket.io');

const { registerSocket, attachDebugEndpoints } = require('./utils/realtime');
const { startRecurringEngine } = require('./services/recurring.engine');

const app = express();

/* ───────────── Env toggles ───────────── */
const isProd     = process.env.NODE_ENV === 'production';
const forceHTTPS = String(process.env.FORCE_HTTPS || '').toLowerCase() === 'true';
if (isProd) app.set('trust proxy', 1);

/* ───────────── CORS ───────────── */
const rawOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const wildcard = rawOrigins.includes('*');
const corsOptions = wildcard
  ? { origin: true, credentials: false }
  : { origin: rawOrigins, credentials: true };

app.use(cors(corsOptions));

/* ───────────── Security & Perf ───────────── */
app.use(helmet({
  hsts: forceHTTPS,
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
if (!forceHTTPS) {
  app.use((req, res, next) => { res.removeHeader('Strict-Transport-Security'); next(); });
}
app.use(compression());

/* ───────────── Parsers & Limits ───────────── */
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

/* ───────────── Basic rate limit on API ───────────── */
app.use('/api', rateLimit({ windowMs: 60_000, max: 200 }));

/* ───────────── Health ───────────── */
app.get('/api/health', (_req, res) => res.send('✅ API running'));

/* ───────────── Attach io onto req (for controllers) ───────────── */
app.use((req, _res, next) => { req.io = app.get('io'); next(); });

/* ───────────── Routes ───────────── */
// Auth
app.use('/api/auth',   require('./routes/auth.routes'));

// Directory/public
app.use('/api/public', require('./routes/public-directory.routes'));
app.use('/api/public', require('./routes/food/food-public.routes'));

// Admin (Food)
app.use('/api/admin',  require('./routes/food/food-admin.routes'));

// Chef (Food) — dedicated router that mirrors admin controllers
// Endpoint: /api/chef/food-requests (list, get, update, status, delete)
app.use('/api/chef/food-requests', require('./routes/food/food-chef.routes'));

// Static uploads
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || 'uploads')));

// Transportation
app.use('/api/car-bookings',        require('./routes/transportation/carBooking.routes'));
app.use('/api/admin/car-bookings',  require('./routes/transportation/carBooking-admin.routes'));
app.use('/api/admin',               require('./routes/admin-user.routes'));
app.use('/api/driver',              require('./routes/transportation/carBooking-driver.routes'));
// Optional alias for legacy callers
app.use('/api/public/car-bookings', require('./routes/transportation/carBooking.routes'));

// public routes (holiday)
app.use('/api/public', require('./routes/public-holidays.routes'))


/* ───────────── 404 for API (keep above SPA static + after all API mounts) ───────────── */
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

/* ───────────── Error handler ───────────── */
app.use((err, _req, res, _next) => {
  if (!isProd) console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Server error',
    ...(!isProd && { stack: err.stack }),
  });
});

/* ───────────── Static SPA (optional) ─────────────
   Set FRONTEND_DIR=/absolute/path/to/frontend/dist
*/
const frontendDir = process.env.FRONTEND_DIR;
if (frontendDir) {
  const distPath = path.resolve(frontendDir);
  app.use(express.static(distPath));
  // MUST be last (after API handlers), so it doesn't swallow /api 404
  app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

/* ───────────── HTTP + Socket.IO ───────────── */
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60_000,
  pingInterval: 25_000,
  connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: true },
});
registerSocket(io);
app.set('io', io);
attachDebugEndpoints(app);

/* ───────────── Boot ───────────── */
const PORT = Number(process.env.PORT || 4333);

(async function boot() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {});
    console.log('✅ MongoDB connected');

    server.listen(PORT, () => {
      const proto = forceHTTPS ? 'https' : 'http';
      console.log(`🚀 Server listening on ${proto}://0.0.0.0:${PORT}`);
    });

    // 🔁 start recurring engine after IO is ready
    const stopRecurring = startRecurringEngine(io);

    // graceful shutdown
    const shutdown = async (sig) => {
      console.log(`\n${sig} received. Shutting down...`);
      stopRecurring && stopRecurring();
      server.close(() => console.log('HTTP server closed'));
      await mongoose.connection.close();
      process.exit(0);
    };
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
})();
