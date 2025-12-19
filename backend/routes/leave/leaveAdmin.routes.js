// backend/routes/leave/leaveAdmin.routes.js
const express = require('express')
const router = express.Router()

// ✅ use the controller you pasted (leaveProfiles.admin.controller.js)
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

// ✅ match the exported function names in leaveProfiles.admin.controller.js
router.get('/approvers', ctrl.getApprovers)
router.get('/profiles/grouped', ctrl.getProfilesGrouped)

router.get('/profiles/:employeeId', ctrl.getProfileOne)
router.post('/profiles', ctrl.createProfileSingle)
router.put('/profiles/:employeeId', ctrl.updateProfile)
router.delete('/profiles/:employeeId', ctrl.deactivateProfile)

// bulk
router.post('/managers', ctrl.createManagerWithEmployees)

module.exports = router
