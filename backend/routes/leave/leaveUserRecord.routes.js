// backend/routes/leave/leaveUserRecord.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveRecord.user.controller')

// GET /api/leave/user/record
router.get('/record', requireAuth, ctrl.getMyLeaveRecord)

module.exports = router
