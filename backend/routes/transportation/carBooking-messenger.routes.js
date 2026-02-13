// backend/routes/transportation/carBooking-messenger.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth')

/**
 * MESSENGER endpoints
 * Mounted at: /api/messenger
 * So final paths:
 *   GET    /api/messenger/car-bookings
 *   POST   /api/messenger/car-bookings/:id/ack
 *   PATCH  /api/messenger/car-bookings/:id/status
 */

// ✅ MUST be logged in + must be MESSENGER
router.use(requireAuth, requireRole('MESSENGER'))

// ✅ List messenger’s assigned tasks
router.get('/car-bookings', ctrl.listMessengerTasks)
// If you prefer the generic one, you can use ctrl.listForAssignee instead:
// router.get('/car-bookings', ctrl.listForAssignee)

// ✅ Messenger acknowledgment (accept / decline)
router.post('/car-bookings/:id/ack', ctrl.messengerAcknowledge)

// ✅ Messenger live status update (ON_ROAD → ARRIVING → COMPLETED)
router.patch('/car-bookings/:id/status', ctrl.messengerUpdateStatus)

module.exports = router