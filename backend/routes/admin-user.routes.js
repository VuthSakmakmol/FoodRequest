// backend/routes/admin-user.routes.js
const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/adminUser.controller')

// Mount at /api/admin
router.get('/users', ctrl.listByRole)                // /api/admin/users?role=DRIVER|MESSENGER
router.get('/drivers', ctrl.listDrivers)             // /api/admin/drivers
router.get('/messengers', ctrl.listMessengers)       // /api/admin/messengers
router.get('/availability/assignees', ctrl.busyAssignees)
// /api/admin/availability/assignees?role=DRIVER&date=YYYY-MM-DD&start=HH:MM&end=HH:MM

module.exports = router
