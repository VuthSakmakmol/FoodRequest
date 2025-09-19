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

const app = express();

/* ───────────── Env toggles ───────────── */
const isProd     = process.env.NODE_ENV === 'production';
const forceHTTPS = String(process.env.FORCE_HTTPS || '').toLowerCase() === 'true';
// If you're behind a proxy/NGINX in prod, this helps detect https correctly.
if (isProd) app.set('trust proxy', 1);

/* ───────────── CORS (wildcard-safe) ───────────── */
const rawOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const wildcard = rawOrigins.includes('*');
const corsOptions = wildcard
  ? { origin: true, credentials: false }
  : { origin: rawOrigins, credentials: true };

app.use(cors(corsOptions));

/* ───────────── Security & Perf ─────────────
   IMPORTANT: Do NOT enable HSTS unless you truly serve HTTPS end-to-end.
   Also avoid CSP 'upgrade-insecure-requests' during HTTP dev.
*/
app.use(helmet({
  // Only send HSTS header when we know requests reach us via HTTPS
  hsts: forceHTTPS,
  // Turn off default CSP; add your own later without 'upgrade-insecure-requests'
  contentSecurityPolicy: false,
  // These two are noisy on plain HTTP; safe to disable for dev
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Safety: if not forcing HTTPS, make sure no stray HSTS header leaks out.
if (!forceHTTPS) {
  app.use((req, res, next) => {
    res.removeHeader('Strict-Transport-Security');
    next();
  });
}

app.use(compression());

/* ───────────── Parsers & Limits (order matters) ───────────── */
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

/* ───────────── Basic rate limit on API ───────────── */
app.use('/api', rateLimit({ windowMs: 60_000, max: 200 }));

/* ───────────── Health ───────────── */
app.get('/api/health', (_req, res) => res.send('✅ API running'));

/* ───────────── Attach io onto req (for controllers) ───────────── */
app.use((req, _res, next) => { req.io = app.get('io'); next(); });

/* ───────────── Routes ───────────── */
app.use('/api/auth',   require('./routes/auth.routes'));
app.use('/api/public', require('./routes/public-directory.routes'));
app.use('/api/public', require('./routes/food-public.routes'));
app.use('/api/admin',  require('./routes/food-admin.routes'));

/* ───────────── 404 for API (before error handler) ───────────── */
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

/* ───────────── Error handler (don’t leak stack in prod) ───────────── */
app.use((err, _req, res, _next) => {
  if (!isProd) console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Server error',
    ...(!isProd && { stack: err.stack }),
  });
});

/* ───────────── Static SPA (optional) ─────────────
   Set FRONTEND_DIR=/var/www/yourapp/frontend/dist
*/
const frontendDir = process.env.FRONTEND_DIR;
if (frontendDir) {
  const distPath = path.resolve(frontendDir);
  app.use(express.static(distPath));
  // keep this LAST (after API routes & error handler for /api)
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

    /* Graceful shutdown */
    const shutdown = async (sig) => {
      console.log(`\n${sig} received. Shutting down...`);
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
