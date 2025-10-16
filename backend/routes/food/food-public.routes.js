// backend/routes/food/food-public.routes.js
const express = require('express');
const router = express.Router();
const food = require('../../controllers/food/foodRequest.controller');

// PUBLIC endpoints used by Employee pages
// Create a new request (can be recurring-enabled; template gets created automatically)
router.post('/food-requests', food.createRequest);

// List requests (supports status/employeeId/q/from/to/page/limit via controller’s query handling)
router.get('/food-requests', food.listRequests);

module.exports = router;
