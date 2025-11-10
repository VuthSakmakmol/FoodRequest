// backend/routes/transportation/carBooking-messenger.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')

/**
 * MESSENGER endpoints
 * Base URL: /api/messenger/car-bookings
 */

// ✅ List messenger’s assigned tasks
router.get('/', ctrl.listForAssignee)

// ✅ Messenger acknowledgment (accept / decline)
router.post('/:id/ack', ctrl.messengerAcknowledge)

// ✅ Messenger live status update (ON_ROAD → ARRIVING → COMPLETED)
router.patch('/:id/status', ctrl.messengerUpdateStatus)

module.exports = router
