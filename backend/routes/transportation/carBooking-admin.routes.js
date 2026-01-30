const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')
const { upload } = require('../../middlewares/upload')

// Base: /api/admin/car-bookings

// ✅ Export MUST be above "/:id" routes
router.get('/export', ctrl.exportAdminExcel)

// List all (optional filters: ?date=&status=&category=&q=)
router.get('/', ctrl.listAdmin)

// Admin can edit core fields (date/time/stops/passengers/notes/ticket)
router.patch('/:id', upload.single('ticket'), ctrl.updateBooking)

// Status change
router.patch('/:id/status', ctrl.updateStatus)

// Assign / re-assign
router.post('/:id/assign', ctrl.assignBooking)
router.patch('/:id/assign', ctrl.assignBooking)

// Delete
router.delete('/:id', ctrl.deleteBooking)

module.exports = router
