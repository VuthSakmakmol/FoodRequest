const express = require('express')
const router = express.Router()

const bookingCtrl = require('../../controllers/bookingRoom/bookingRoom.controller')
const roomAdminCtrl = require('../../controllers/bookingRoom/RoomAdmin.controller')
const materialAdminCtrl = require('../../controllers/bookingRoom/MaterialAdmin.controller')

router.post('/booking-room', bookingCtrl.createBooking)
router.get('/booking-room/schedule', bookingCtrl.listSchedulePublic)

router.get('/booking-room/rooms/active', roomAdminCtrl.listActiveRooms)
router.get('/booking-room/rooms/:id/image', roomAdminCtrl.streamRoomImage)

router.get('/booking-room/materials/active', materialAdminCtrl.listActiveMaterials)
router.get('/booking-room/availability', bookingCtrl.getAvailability)

router.get('/booking-room/my', bookingCtrl.listMyBookings)
router.patch('/booking-room/:id', bookingCtrl.updateBooking)
router.post('/booking-room/:id/cancel', bookingCtrl.cancelBooking)

module.exports = router