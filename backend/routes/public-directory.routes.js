// backend/routes/public-directory.routes.js
const express = require('express')
const router = express.Router()
const controller = require('../controllers/employeeDirectory.controller')

router.get('/employees', controller.getEmployees)
module.exports = router
