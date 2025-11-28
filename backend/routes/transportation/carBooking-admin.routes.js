// backend/routes/carBooking-admin.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/transportation/carBooking.controller');
const { upload } = require('../../middlewares/upload'); // uses .single('ticket')

// Base: /api/admin/car-bookings

// List all (optional filters: ?date=&status=)
router.get('/', ctrl.listAdmin);

// Admin can edit core fields (date/time/stops/passengers/notes/ticket)
// No status/assignment change here.
router.patch('/:id', upload.single('ticket'), ctrl.updateBooking);

// Status change (PENDING → ACCEPTED → ON_ROAD → ...)
router.patch('/:id/status', ctrl.updateStatus);

// Assign / re-assign Driver or Messenger (with overlap checks)
router.post('/:id/assign', ctrl.assignBooking);  // allow POST
router.patch('/:id/assign', ctrl.assignBooking); // and PATCH

// Optional hard delete (or keep as CANCELLED in future if you prefer soft-delete)
router.delete('/:id', ctrl.deleteBooking);

module.exports = router;
