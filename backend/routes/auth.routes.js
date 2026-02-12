// routes/auth.routes.js
const router = require('express').Router()
const ctrl = require('../controllers/auth.controller')
const { requireAuth, requireRole } = require('../middlewares/auth')

router.post('/login', ctrl.login)
router.get('/me', requireAuth, ctrl.me)

router.post('/chef/login', (req, res, next) => {
  req.body = { ...req.body, portal: 'chef' }
  ctrl.login(req, res, next)
})

// ✅ ADMIN can create users (multi-role supported now)
router.post('/users', requireAuth, requireRole('ADMIN'), ctrl.createUser)

module.exports = router
