const router = require('express').Router()
const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/centralReport.controller')

router.use(requireAuth)

// viewer roles (same idea as your admin viewers)
router.get(
  '/reports/central',
  requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.getCentralReport
)

module.exports = router