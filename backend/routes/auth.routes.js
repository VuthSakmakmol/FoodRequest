//routes/auth.routes.js

const router = require('express').Router()
const ctrl = require('../controllers/auth.controller')
const { requireAuth, requireRole } = require('../middlewares/auth')

router.post('/login', ctrl.login)
router.get('/me', requireAuth, ctrl.me)
router.post('/users', requireAuth, requireRole('ADMIN'), ctrl.createUser) // create Chef/Admin

module.exports = router
