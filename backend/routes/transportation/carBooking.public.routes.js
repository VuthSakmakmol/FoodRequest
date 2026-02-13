//backend/routes/transportation/carBooking.public.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')
const { upload } = require('../../middlewares/upload') // multer with .single('ticket')

// ✅ Public availability check
router.get('/checkAvailability', ctrl.checkAvailability)

// ✅ Optional: public schedule
router.get('/schedule', ctrl.listSchedulePublic)

// ✅ ✅ ✅ PUBLIC create booking (this is the missing route)
router.post('/car-bookings', upload.single('ticket'), ctrl.createBooking)

module.exports = router