// backend/routes/food/food-chef.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/food/foodRequest.controller')

router.get('/', requireAuth, requireRole('CHEF', 'ADMIN'), ctrl.listRequests)
router.patch('/:id/status', requireAuth, requireRole('CHEF', 'ADMIN'), ctrl.updateStatus)
router.patch('/:id', requireAuth, requireRole('CHEF', 'ADMIN'), ctrl.updateRequest)
router.delete('/:id', requireAuth, requireRole('CHEF', 'ADMIN'), ctrl.deleteRequest)

module.exports = router
