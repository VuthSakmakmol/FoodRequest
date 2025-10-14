// backend/routes/carBooking-driver.routes.js

const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/carBooking.controller')

// List assigned to driver
router.get('/car-bookings', ctrl.listForAssignee)

// Driver acknowledgment (second step)
router.post('/car-bookings/:id/ack', ctrl.driverAcknowledge)

// Driver updates live status (after ack ACCEPTED)
router.patch('/car-bookings/:id/status', ctrl.driverUpdateStatus)

module.exports = router
