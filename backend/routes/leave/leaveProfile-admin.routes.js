// backend/routes/leave/leaveProfiles-admin.routes.js
const router = require('express').Router()
const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

// IMPORTANT: must have auth middleware that sets req.user
const { requireAuth, requireRole } = require('../../middlewares/auth')
router.use(requireAuth)
router.use(requireRole('LEAVE_ADMIN', 'ADMIN'))

router.get('/approvers', ctrl.getApprovers)
router.get('/profiles/grouped', ctrl.getProfilesGrouped)
router.get('/profiles/:employeeId', ctrl.getProfileOne)
router.post('/profiles', ctrl.createProfileSingle)
router.put('/profiles/:employeeId', ctrl.updateProfile)
router.delete('/profiles/:employeeId', ctrl.deactivateProfile)
router.post('/managers', ctrl.createManagerWithEmployees)

module.exports = router
