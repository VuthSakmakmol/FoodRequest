const express = require('express')
const router = express.Router()
const food = require('../../controllers/food/foodRequest.controller')

router.post('/food-requests', food.createRequest)
router.get('/food-requests', food.listRequests)
router.patch('/food-requests/:id/cancel', food.cancelRequestPublic)

module.exports = router
