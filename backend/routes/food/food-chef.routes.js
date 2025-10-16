// backend/routes/food/food-chef.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/food/foodRequest.controller')

// For debugging; remove once stable
console.log('[chef routes] ctrl keys:', Object.keys(ctrl || {}))

// ──────────────────────────────────────────────────────────────
// Endpoints (mirror admin behavior but gated for CHEF/ADMIN)
// NOTE: We only add routes that your controller actually exports.
// Your Chef UI uses GET / and PATCH /:id/status.
// ──────────────────────────────────────────────────────────────

// LIST requests (supports q/status/from/to in ctrl.listRequests)
router.get(
  '/',
  requireAuth,
  requireRole('CHEF', 'ADMIN'),
  ctrl.listRequests
)

// UPDATE status
router.patch(
  '/:id/status',
  requireAuth,
  requireRole('CHEF', 'ADMIN'),
  ctrl.updateStatus
)

// (Optional) UPDATE request (if you need full edits from Chef)
router.patch(
  '/:id',
  requireAuth,
  requireRole('CHEF', 'ADMIN'),
  ctrl.updateRequest
)

// (Optional) DELETE request
router.delete(
  '/:id',
  requireAuth,
  requireRole('CHEF', 'ADMIN'),
  ctrl.deleteRequest
)

// (Deliberately NO GET '/:id' here because your controller
// doesn’t export a "getOne" / "getById" handler.)

module.exports = router
