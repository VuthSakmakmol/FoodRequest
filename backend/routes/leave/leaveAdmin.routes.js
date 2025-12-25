// backend/routes/leave/leaveAdmin.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../../controllers/leave/leaveProfiles.admin.controller')

// --- Auth / Role guard (keep your pattern) ---
const jwt = require('jsonwebtoken')

function getRoles(req) {
  const rawRoles = Array.isArray(req.user?.roles) ? req.user.roles : []
  const baseRole = req.user?.role ? [req.user.role] : []
  return [...new Set([...rawRoles, ...baseRole].map(r => String(r || '').toUpperCase()))]
}

function requireAuth(req, res, next) {
  if (req.user) return next()

  const hdr = String(req.headers.authorization || '')
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : ''
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    // NOTE: this uses simple verify (no issuer/audience check).
    // If you want stricter, use your shared middlewares/auth.js instead.
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
    req.user = decoded
    return next()
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}

function requireLeaveAdmin(req, res, next) {
  const roles = getRoles(req)
  if (roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')) return next()
  return res.status(403).json({ message: 'Forbidden' })
}

router.use(requireAuth)
router.use(requireLeaveAdmin)

// ─────────────────────────────────────────────
// Admin leave endpoints
// Mounted at: /api/admin/leave   (from server.js)
// ─────────────────────────────────────────────

// approvers
router.get('/approvers', ctrl.getApprovers)

// ✅ IMPORTANT: make frontend-friendly endpoints
// Your UI calls GET /profiles, so provide it:
router.get('/profiles', ctrl.getProfilesGrouped)

// keep your old endpoint too (backward compatible)
router.get('/profiles/grouped', ctrl.getProfilesGrouped)

// profile CRUD
router.get('/profiles/:employeeId', ctrl.getProfileOne)
router.post('/profiles', ctrl.createProfileSingle)

// your UI likely uses PATCH; allow both PATCH + PUT
router.patch('/profiles/:employeeId', ctrl.updateProfile)
router.put('/profiles/:employeeId', ctrl.updateProfile)

router.delete('/profiles/:employeeId', ctrl.deactivateProfile)

// bulk manager + employees
// ✅ your UI likely calls POST /profiles/manager
router.post('/profiles/manager', ctrl.createManagerWithEmployees)

// keep your old endpoint too
router.post('/managers', ctrl.createManagerWithEmployees)

// renew contract
router.post('/profiles/:employeeId/contracts/renew', ctrl.renewContract)

module.exports = router
