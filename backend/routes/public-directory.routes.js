// backend/routes/public-directory.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../controllers/public.controller')

// ✅ MUST be PUBLIC (NO requireAuth, NO requireRole)
router.get('/employees', ctrl.publicEmployees)

module.exports = router