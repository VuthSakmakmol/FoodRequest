// backend/routes/leave/leaveUser.routes.js
const express = require('express')
const router = express.Router()

router.use('/profile', require('./leaveProfile.user.routes'))

module.exports = router
