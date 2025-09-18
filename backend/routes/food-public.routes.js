// backend/routes/food-public.routes.js
const express = require('express')
const router = express.Router()
const food = require('../controllers/foodRequest.controller')

// PUBLIC endpoints used by Employee pages
router.post('/food-requests', food.createRequest)
router.get('/food-requests',  food.listRequests)

module.exports = router
