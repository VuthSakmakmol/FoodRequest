// backend/routes/carBooking-admin.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')

// /api/admin/car-bookings
router.get('/', ctrl.listAdmin)
router.patch('/:id/status', ctrl.updateStatus)
router.post('/:id/assign', ctrl.assignBooking)  // allow POST
router.patch('/:id/assign', ctrl.assignBooking) // and PATCH

module.exports = router
