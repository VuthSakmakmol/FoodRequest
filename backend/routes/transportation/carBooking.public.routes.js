const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/carBooking.controller')

// NO auth — read-only
router.get('/schedule', ctrl.listSchedulePublic)

module.exports = router
