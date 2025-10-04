// backend/routes/carBooking.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../controllers/carBooking.controller')
const { upload } = require('../middlewares/upload') // uses .single('ticket')

router.get('/availability', ctrl.checkAvailability)

router.post('/', upload.single('ticket'), ctrl.createBooking)

// Employee's own bookings
router.get('/mine', ctrl.listMyBookings)

module.exports = router
