// backend/routes/leave/leaveAdmin.routes.js
/* eslint-disable no-console */
const express = require('express')
const jwt = require('jsonwebtoken')

const router = express.Router()

const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

// ─────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────
function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map((r) => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

function requireAuth(req, res, next) {
  if (req.user) return next()

  const hdr = String(req.headers.authorization || '')
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
    req.user = decoded
    return next()
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}

function requireLeaveAdmin(req, res, next) {
  const roles = getRoles(req)
  if (roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')) return next()
  return res.status(403).json({ message: 'Forbidden' })
}

// ✅ guard against "argument handler must be a function"
function h(fn, name) {
  if (typeof fn !== 'function') {
    console.error(`[leaveAdmin.routes] Missing handler: ${name}. Check controller exports.`)
    return (req, res) =>
      res.status(500).json({
        message: `Server misconfigured: missing handler "${name}". Check controller exports.`,
      })
  }
  return fn
}

// ─────────────────────────────────────────────
// Auth & role guard
// ─────────────────────────────────────────────
router.use(requireAuth)
router.use(requireLeaveAdmin)

// ─────────────────────────────────────────────
// Admin leave endpoints
// Mounted at: /api/admin/leave
// ─────────────────────────────────────────────

// Approvers
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

// ✅ REQUIRED for your new admin reset password feature
router.post('/profiles/:employeeId/password', h(ctrl.resetUserPassword, 'resetUserPassword'))


router.patch('/profiles/:employeeId/contracts/:contractNo', h(ctrl.updateContractCarry, 'updateContractCarry'))

module.exports = router
