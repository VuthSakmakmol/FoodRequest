// routes/transportation/carBooking.public.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')

// ✅ Public availability check (frontend calls this)
router.get('/checkAvailability', ctrl.checkAvailability)

// ✅ Optional: view daily schedule for calendar display
router.get('/schedule', ctrl.listSchedulePublic)

module.exports = router
