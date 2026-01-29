// backend/routes/leave/leaveAdmin.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')

// ✅ IMPORTANT: your file is plural in controllers folder
const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

// small helper so server doesn’t crash silently
function must(fnName) {
  if (typeof ctrl[fnName] !== 'function') {
    console.warn(`[leaveAdmin.routes] Missing handler: ${fnName}. Check controller exports.`)
    // return a safe handler to show real error on frontend
    return (_req, _res) => _res.status(500).json({
      message: `Server misconfigured: missing handler "${fnName}". Check controller exports.`
    })
  }
  return ctrl[fnName]
}

router.use(auth.requireAuth)
router.use(auth.requireRole('LEAVE_ADMIN'))

// Approvers
router.get('/admin/leave/approvers', must('getApprovers'))

// Profiles
router.get('/admin/leave/profiles/grouped', must('getProfilesGrouped'))
router.get('/admin/leave/profiles/:employeeId', must('getProfileOne'))

// Create
router.post('/admin/leave/profiles', must('createProfileSingle'))
router.post('/admin/leave/profiles/manager', must('createManagerWithEmployees'))

module.exports = router
