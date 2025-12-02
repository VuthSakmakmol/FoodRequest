// backend/routes/leave/leaveType-admin.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveType.admin.controller')

// Only LEAVE_ADMIN can manage leave types
router.use(requireAuth, requireRole(['LEAVE_ADMIN']))

router.get('/types', ctrl.listTypes)
router.post('/types', ctrl.createType)
router.put('/types/:id', ctrl.updateType)
router.delete('/types/:id', ctrl.deleteType)

module.exports = router
