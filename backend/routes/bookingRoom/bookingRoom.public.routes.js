const express = require('express')
const router = express.Router()

const ctrl = require('../../controllers/bookingRoom/bookingRoom.controller')

// ✅ PUBLIC routes (no requireAuth / no requireRole)
// mount example: /api/public

// create booking request
router.post('/booking-room', ctrl.createBooking)

// public schedule / calendar
router.get('/booking-room/schedule', ctrl.listSchedulePublic)

// public helper lists for request form
router.get('/booking-room/rooms/active', ctrl.listActiveRooms)
router.get('/booking-room/materials/active', ctrl.listActiveMaterials)
router.get('/booking-room/availability', ctrl.getAvailability)

// requester own history
router.get('/booking-room/my', ctrl.listMyBookings)

// requester update before any approval
router.patch('/booking-room/:id', ctrl.updateBooking)

// requester cancel before any approval
router.post('/booking-room/:id/cancel', ctrl.cancelBooking)

module.exports = router