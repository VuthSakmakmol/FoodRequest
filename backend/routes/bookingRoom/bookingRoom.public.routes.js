// backend/routes/bookingRoom/bookingRoom.public.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../../controllers/bookingRoom/bookingRoom.controller')

// ✅ PUBLIC routes (no requireAuth / no requireRole)
// Your middleware already allows /api/public/*

// create booking request
router.post('/booking-room', ctrl.createBooking)

// public schedule / calendar
router.get('/booking-room/schedule', ctrl.listSchedulePublic)

// requester own history
router.get('/booking-room/my', ctrl.listMyBookings)

// requester update before any approval
router.patch('/booking-room/:id', ctrl.updateBooking)

// requester cancel before any approval
router.post('/booking-room/:id/cancel', ctrl.cancelBooking)

module.exports = router