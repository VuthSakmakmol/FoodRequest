// backend/routes/leave/leaveAdmin.routes.js
/* eslint-disable no-console */
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

// ✅ guard against "argument handler must be a function"
function h(fn, name) {
  if (typeof fn !== 'function') {
    console.error(`[leaveAdmin.routes] Missing handler: ${name}. Check controller exports.`)
    return (_req, res) =>
      res.status(500).json({
        message: `Server misconfigured: missing handler "${name}". Check controller exports.`,
      })
  }
  return fn
}

/**
 * Mounted at: /api/admin/leave
 * ✅ Use shared auth (normalizes roles/loginId safely)
 */
router.use(auth.requireAuth)
router.use(auth.requireRole('LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN'))

// Approvers (must include GM + COO in your controller logic)
router.get('/approvers', h(ctrl.getApprovers, 'getApprovers'))

// Profiles list
router.get('/profiles', h(ctrl.getProfilesGrouped, 'getProfilesGrouped'))
router.get('/profiles/grouped', h(ctrl.getProfilesGrouped, 'getProfilesGrouped'))

// Profile CRUD
router.get('/profiles/:employeeId', h(ctrl.getProfileOne, 'getProfileOne'))
router.post('/profiles', h(ctrl.createProfileSingle, 'createProfileSingle'))

router.patch('/profiles/:employeeId', h(ctrl.updateProfile, 'updateProfile'))
router.put('/profiles/:employeeId', h(ctrl.updateProfile, 'updateProfile'))

router.delete('/profiles/:employeeId', h(ctrl.deactivateProfile, 'deactivateProfile'))

// Bulk create: manager + employees
router.post('/profiles/manager', h(ctrl.createManagerWithEmployees, 'createManagerWithEmployees'))
router.post('/managers', h(ctrl.createManagerWithEmployees, 'createManagerWithEmployees'))

// Renew contract
router.post('/profiles/:employeeId/contracts/renew', h(ctrl.renewContract, 'renewContract'))

// Contract history
router.get('/profiles/:employeeId/contracts', h(ctrl.getContractHistory, 'getContractHistory'))

// Recalculate
router.post('/profiles/:employeeId/recalculate', h(ctrl.recalculateBalances, 'recalculateBalances'))

// Admin reset password (no old password)
router.patch('/profiles/:employeeId/password', h(ctrl.resetUserPassword, 'resetUserPassword'))

// Update per-contract carry
router.patch('/profiles/:employeeId/contracts/:contractNo', h(ctrl.updateContractCarry, 'updateContractCarry'))

module.exports = router
