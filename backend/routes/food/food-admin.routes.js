// backend/routes/food/food-admin.routes.js
const express = require('express')
const router = express.Router()

const FoodRequest = require('../../models/food/FoodRequest')
const ctrl = require('../../controllers/food/foodRequest.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth')

const escapeRegExp = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d }
const cap = (v, min, max) => Math.min(Math.max(v, min), max)

router.get(
  '/food-requests',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  async (req, res, next) => {
    try {
      const { status, employeeId, q, from, to } = req.query || {}
      const filter = {}
      if (status && status !== 'ALL') filter.status = status
      if (employeeId) filter['employee.employeeId'] = employeeId

      if (q && q.trim()) {
        const rx = new RegExp(escapeRegExp(q.trim()), 'i')
        filter.$or = [
          { orderType: rx },
          { 'location.kind': rx },
          { specialInstructions: rx },
          { menuChoices: rx },
          { requestId: rx },
        ]
      }

      if (from || to) {
        const range = {}
        if (from) {
          const d = new Date(from)
          if (!isNaN(d.getTime())) range.$gte = d
        }
        if (to) {
          const dt = new Date(to)
          if (!isNaN(dt.getTime())) { dt.setHours(23, 59, 59, 999); range.$lte = dt }
        }
        if (Object.keys(range).length) filter.eatDate = range
      }

      const page = cap(num(req.query.page, 1), 1, 1e6)
      const limit = cap(num(req.query.limit, 50), 1, 200)
      const skip = (page - 1) * limit

      const [rows, total] = await Promise.all([
        FoodRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        FoodRequest.countDocuments(filter),
      ])

      res.json({ rows, page, limit, total })
    } catch (err) { next(err) }
  }
)

/* summary MUST be before :id */
router.get(
  '/food-requests/summary',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  ctrl.dashboard
)

router.get(
  '/food-requests/:id',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  async (req, res, next) => {
    try {
      const doc = await FoodRequest.findById(req.params.id)
      if (!doc) return res.status(404).json({ message: 'Not found' })
      res.json(doc)
    } catch (err) { next(err) }
  }
)

router.patch(
  '/food-requests/:id/status',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  ctrl.updateStatus
)

router.patch(
  '/food-requests/:id',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  ctrl.updateRequest
)

router.delete(
  '/food-requests/:id',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  ctrl.deleteRequest
)

router.get(
  '/dashboard',
  requireAuth,
  requireRole('ADMIN', 'CHEF'),
  ctrl.dashboard
)

module.exports = router
