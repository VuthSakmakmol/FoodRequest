// backend/routes/carBooking.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/carBooking.controller')

// PUBLIC endpoints for employees
router.post('/public/car', ctrl.publicCreateCar)
router.get('/public/car', ctrl.publicListByEmployee)          // ?employeeId=E123
router.post('/public/car/:id/cancel', ctrl.publicCancel)

module.exports = router
