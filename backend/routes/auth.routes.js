// routes/auth.routes.js
const router = require('express').Router()
const ctrl = require('../controllers/auth.controller')
const { requireAuth, requireRole } = require('../middlewares/auth')

// ---------- Auth ----------
router.post('/login', ctrl.login)                 // general login
router.get('/me', requireAuth, ctrl.me)           // whoami

// Optional: Chef-portal login alias (blocks non-chef roles in controller)
router.post('/chef/login', (req, res, next) => {
  req.body = { ...req.body, portal: 'chef' }
  ctrl.login(req, res, next)
})

// ---------- User management ----------
router.post('/users', requireAuth, requireRole('ADMIN'), ctrl.createUser) // create any role (admin only)

// (No chef creation route — chefs are seeded, per your requirement)

module.exports = router
