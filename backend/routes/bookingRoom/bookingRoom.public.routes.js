// backend/routes/bookingRoom/bookingRoom.public.routes.js
const express = require('express')
const router = express.Router()

const bookingCtrl = require('../../controllers/bookingRoom/bookingRoom.controller')
const roomAdminCtrl = require('../../controllers/bookingRoom/RoomAdmin.controller')
const materialAdminCtrl = require('../../controllers/bookingRoom/MaterialAdmin.controller')

// ✅ PUBLIC routes (no requireAuth / no requireRole)
// mount example: /api/public

/* ───────────────── Request create / schedule ───────────────── */
router.post('/booking-room', bookingCtrl.createBooking)
router.get('/booking-room/schedule', bookingCtrl.listSchedulePublic)

/* ───────────────── Public helper lists ───────────────── */
router.get('/booking-room/rooms/active', roomAdminCtrl.listActiveRooms)
router.get('/booking-room/materials/active', materialAdminCtrl.listActiveMaterials)
router.get('/booking-room/availability', bookingCtrl.getAvailability)

/* ───────────────── Requester own history ───────────────── */
router.get('/booking-room/my', bookingCtrl.listMyBookings)

/* ───────────────── Requester update / cancel ───────────────── */
router.patch('/booking-room/:id', bookingCtrl.updateBooking)
router.post('/booking-room/:id/cancel', bookingCtrl.cancelBooking)

module.exports = router