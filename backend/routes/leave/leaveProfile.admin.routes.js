// backend/routes/leave/leaveProfile.admin.routes.js
const express = require('express')
const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

const router = express.Router()

function must(fnName) {
  if (typeof ctrl[fnName] !== 'function') {
    throw new Error(`[leaveProfile.admin.routes] Missing handler export: ${fnName}`)
  }
  return ctrl[fnName]
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

router.use(auth.requireAuth, auth.requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'))

router.get('/admin/leave/types', wrap(must('getLeaveTypes')))
router.get('/admin/leave/approvers', wrap(must('getApprovers')))
router.get('/admin/leave/profiles/grouped', wrap(must('getProfilesGrouped')))
router.get('/admin/leave/profiles/:employeeId', wrap(must('getProfileOne')))

router.post('/admin/leave/profiles', wrap(must('createProfileSingle')))
router.post('/admin/leave/managers', wrap(must('createManagerWithEmployees')))
router.post('/admin/leave/profiles/manager-with-employees', wrap(must('createManagerWithEmployees')))

router.patch('/admin/leave/profiles/:employeeId', wrap(must('updateProfile')))

// ✅ recalc endpoints (your frontend tries these fallbacks)
router.post('/admin/leave/profiles/:employeeId/recalculate', wrap(must('recalculateProfile')))
router.post('/admin/leave/profiles/:employeeId/recalc', wrap(must('recalculateProfile')))
router.post('/admin/leave/profiles/:employeeId/balances/recalc', wrap(must('recalculateProfile')))

router.post('/admin/leave/profiles/:employeeId/contracts/renew', wrap(must('renewContract')))
router.delete('/admin/leave/profiles/:employeeId', wrap(must('deactivateProfile')))

module.exports = router
