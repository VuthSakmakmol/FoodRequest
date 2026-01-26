// backend/routes/leave/leaveAdmin.routes.js
/* eslint-disable no-console */
const express = require('express')
const jwt = require('jsonwebtoken')

const router = express.Router()

// ✅ Controller (must export the functions used below)
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
    // Return a safe handler so server won't crash; it will return 500 with clear message.
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
// Mounted at: /api/admin/leave   (from server.js)
// ─────────────────────────────────────────────

// Approvers (GM / COO mapping lists, etc.)
router.get('/approvers', h(ctrl.getApprovers, 'getApprovers'))

// Profiles list (frontend-friendly)
router.get('/profiles', h(ctrl.getProfilesGrouped, 'getProfilesGrouped'))

// Backward compatible
router.get('/profiles/grouped', h(ctrl.getProfilesGrouped, 'getProfilesGrouped'))

// Profile CRUD
router.get('/profiles/:employeeId', h(ctrl.getProfileOne, 'getProfileOne'))
router.post('/profiles', h(ctrl.createProfileSingle, 'createProfileSingle'))

// Update (allow PATCH + PUT)
router.patch('/profiles/:employeeId', h(ctrl.updateProfile, 'updateProfile'))
router.put('/profiles/:employeeId', h(ctrl.updateProfile, 'updateProfile'))

// Deactivate
router.delete('/profiles/:employeeId', h(ctrl.deactivateProfile, 'deactivateProfile'))

// Bulk create: manager + employees
// ✅ UI calls POST /profiles/manager
router.post('/profiles/manager', h(ctrl.createManagerWithEmployees, 'createManagerWithEmployees'))

// Backward compatible endpoint
router.post('/managers', h(ctrl.createManagerWithEmployees, 'createManagerWithEmployees'))

// Renew contract
router.post(
  '/profiles/:employeeId/contracts/renew',
  h(ctrl.renewContract, 'renewContract')
)

module.exports = router
