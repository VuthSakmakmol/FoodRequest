// backend/routes/carBooking-admin.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../controllers/carBooking.controller')

// If you have auth/role middleware, import and use it here.
// const auth = require('../middlewares/auth')
// const requireAdmin = auth.requireAdmin || ((req,res,next)=>next())

// List bookings (filter by ?date=YYYY-MM-DD&status=PENDING)
router.get('/', /* requireAdmin, */ ctrl.listAdmin)

// Update workflow status (ACCEPTED/ON_ROAD/ARRIVING/COMPLETED/DELAYED/CANCELLED)
router.patch('/:id/status', /* requireAdmin, */ ctrl.updateStatus)

// Assign driver/vehicle (future-proofed, but ready now)
router.patch('/:id/assign', /* requireAdmin, */ ctrl.assignBooking)

module.exports = router
