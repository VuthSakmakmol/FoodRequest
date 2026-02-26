// backend/middlewares/auth.js
const jwt = require('jsonwebtoken')
const User = require('../models/User')

function normalizeRole(r) {
  return String(r || '').trim().toUpperCase()
}

function getUserRolesFromJwtPayload(payload) {
  const rolesArr = Array.isArray(payload?.roles) ? payload.roles : []
  const roleOne = payload?.role ? [payload.role] : []
  return [...new Set([...rolesArr, ...roleOne].map(normalizeRole).filter(Boolean))]
}

// ✅ Public paths (NEVER require token / role)
function isPublic(req) {
  const url = String(req.originalUrl || '')

  // health checks
  if (url === '/healthz') return true
  if (url === '/api/health') return true

  // auth login should stay public
  if (url.startsWith('/api/auth/login')) return true
  if (url.startsWith('/api/auth/chef/login')) return true // optional if you use it

  // all public APIs
  if (url.startsWith('/api/public/')) return true

  // socket.io handshake endpoints should not be blocked by role middleware
  if (url.startsWith('/socket.io/')) return true

  return false
}

/**
 * ✅ requireAuth (with passwordVersion revoke)
 * - verifies JWT
 * - normalizes roles
 * - checks DB:
 *    - user exists
 *    - user active
 *    - token.passwordVersion matches user.passwordVersion (revokes old sessions)
 */
exports.requireAuth = async (req, res, next) => {
  // ✅ allow public endpoints
  if (isPublic(req)) return next()

  console.log('[MW] requireAuth →', req.method, req.originalUrl)

  const hdr = req.headers.authorization || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1] || req.cookies?.access_token

  if (!token) {
    console.log('[MW] requireAuth ❌ no token')
    return res.status(401).json({ message: 'Unauthorized' })
  }

  try {
    let payload
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret', {
        issuer: 'food-app',
        audience: 'food-web',
      })
      console.log('[MW] requireAuth ✅ strict verify OK')
    } catch (e) {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
      console.log('[MW] requireAuth ✅ fallback verify OK')
    }

    // compat: some old tokens may use id instead of loginId
    if (!payload.loginId && payload.id) payload.loginId = payload.id

    payload.roles = getUserRolesFromJwtPayload(payload)
    if (!payload.role && payload.roles.length) payload.role = payload.roles[0]

    console.log('[MW] requireAuth user=', payload.loginId, 'roles=', payload.roles)

    // ✅ token revocation check
    const userId = String(payload.sub || '').trim()
    if (!userId) {
      console.log('[MW] requireAuth ❌ missing payload.sub')
      return res.status(401).json({ message: 'Invalid token' })
    }

    const u = await User.findById(userId).select('isActive passwordVersion').lean()
    if (!u) {
      console.log('[MW] requireAuth ❌ user not found for sub=', userId)
      return res.status(401).json({ message: 'Invalid token' })
    }

    if (u.isActive === false) {
      console.log('[MW] requireAuth ❌ account disabled loginId=', payload.loginId)
      return res.status(403).json({ message: 'Account disabled' })
    }

    const tokenVer = Number(payload.passwordVersion || 0)
    const dbVer = Number(u.passwordVersion || 0)

    if (tokenVer !== dbVer) {
      console.log(
        '[MW] requireAuth ❌ token revoked loginId=',
        payload.loginId,
        'tokenVer=',
        tokenVer,
        'dbVer=',
        dbVer
      )
      return res.status(401).json({ message: 'Session expired. Please login again.' })
    }

    req.user = payload
    next()
  } catch (e) {
    console.log('[MW] requireAuth ❌ invalid token:', e?.message)
    return res.status(401).json({ message: 'Invalid token' })
  }
}

exports.requireRole = (...roles) => {
  const allow = roles.map(normalizeRole).filter(Boolean)

  return (req, res, next) => {
    // ✅ NEVER role-protect public endpoints
    if (isPublic(req)) return next()

    console.log('[MW] requireRole(', allow.join(','), ') →', req.method, req.originalUrl)

    if (!req.user) {
      console.log('[MW] requireRole ❌ no req.user')
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const myRoles = Array.isArray(req.user.roles) ? req.user.roles : []
    const single = req.user.role ? [req.user.role] : []
    const all = [...new Set([...myRoles, ...single].map(normalizeRole).filter(Boolean))]

    console.log('[MW] requireRole user=', req.user.loginId, 'has=', all)

    if (!all.some((r) => allow.includes(r))) {
      console.log('[MW] requireRole ❌ FORBIDDEN. allow=', allow, 'has=', all)
      return res.status(403).json({ message: 'Forbidden' })
    }

    console.log('[MW] requireRole ✅ OK')
    next()
  }
}