// backend/routes/bookingRoom/bookingRoom.routes.js
const express = require('express')
const router = express.Router()

const bookingCtrl = require('../../controllers/bookingRoom/bookingRoom.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth')
const BookingRoomRecurring = require('../../models/bookingRoom/BookingRoomRecurring')

// ✅ all below require login
router.use(requireAuth)

/* ───────────────── Shared admin booking list / export ───────────────── */
router.get(
  '/booking-room/admin/list',
  requireRole('ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  bookingCtrl.listAdmin
)

router.get(
  '/booking-room/admin/export',
  requireRole('ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  bookingCtrl.exportAdminExcel
)

module.exports = router