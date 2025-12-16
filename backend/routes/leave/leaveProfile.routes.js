// backend/routes/leave/leaveProfile.routes.js
const express = require('express')
const router = express.Router()

const { requireAuth, requireRole } = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfile.user.controller')

// Debug
console.log('[leave profile routes] ctrl keys:', Object.keys(ctrl))

router.use(requireAuth)

/**
 * GET /my
 * Mount example:
 *   app.use('/api/leave/profile', router)
 * Final endpoint:
 *   GET /api/leave/profile/my
 */
router.get(
  '/my',
  requireRole(
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'ADMIN'
  ),
  (req, res, next) => {
    console.log('➡️  [leave] GET /api/leave/profile/my hit')
    next()
  },
  ctrl.getMyProfile
)

router.get(
  '/managed',
  requireRole('LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'),
  ctrl.listManagedProfiles
)


module.exports = router
