// backend/routes/auth.routes.js
const router = require('express').Router()

const ctrl = require('../controllers/auth.controller')
const { requireAuth, requireRole } = require('../middlewares/auth')

/**
 * ✅ Debug middleware (logs every /api/auth request)
 * You can remove later after everything works.
 */
router.use((req, _res, next) => {
  const t = new Date().toISOString()
  console.log(`[AUTH ROUTER] ${t} ${req.method} ${req.originalUrl}`)
  console.log(`[AUTH ROUTER] headers.authorization =`, req.headers.authorization ? '(present)' : '(none)')
  console.log(`[AUTH ROUTER] body =`, req.body)
  next()
})

/* ✅ PUBLIC: normal login */
router.post('/login', (req, res, next) => {
  console.log('[AUTH ROUTER] ✅ HIT POST /login')
  return ctrl.login(req, res, next)
})

/* ✅ PUBLIC: chef portal login (wraps normal login) */
router.post('/chef/login', (req, res, next) => {
  console.log('[AUTH ROUTER] ✅ HIT POST /chef/login → forcing portal=chef')
  req.body = { ...(req.body || {}), portal: 'chef' }
  return ctrl.login(req, res, next)
})

/* ✅ PRIVATE: current user info */
router.get('/me', requireAuth, (req, res, next) => {
  console.log('[AUTH ROUTER] ✅ HIT GET /me (authed loginId=', req.user?.loginId, ')')
  return ctrl.me(req, res, next)
})

/* ✅ PRIVATE: create users (allow ADMIN or LEAVE_ADMIN) */
router.post('/users', requireAuth, requireRole('ADMIN', 'LEAVE_ADMIN'), (req, res, next) => {
  console.log('[AUTH ROUTER] ✅ HIT POST /users (creator loginId=', req.user?.loginId, ', roles=', req.user?.roles, ')')
  return ctrl.createUser(req, res, next)
})

module.exports = router
