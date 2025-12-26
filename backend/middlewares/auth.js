// backend/middlewares/auth.js
const jwt = require('jsonwebtoken')

function normalizeRole(r) {
  return String(r || '').trim().toUpperCase()
}

function getUserRolesFromJwtPayload(payload) {
  const rolesArr = Array.isArray(payload?.roles) ? payload.roles : []
  const roleOne = payload?.role ? [payload.role] : []
  return [...new Set([...rolesArr, ...roleOne].map(normalizeRole).filter(Boolean))]
}

exports.requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1] || req.cookies?.access_token
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    // ✅ 1) Strict verify first (matches your signToken issuer/audience)
    let payload
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret', {
        issuer: 'food-app',
        audience: 'food-web',
      })
    } catch (e) {
      // ✅ 2) Fallback verify for older tokens / other modules that didn’t set issuer/audience
      // (Prevents random 401/403 during migration)
      payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
    }

    // ✅ normalize loginId for all code paths
    // some tokens use "id" only, some use "loginId"
    if (!payload.loginId && payload.id) payload.loginId = payload.id

    // ✅ normalize roles
    payload.roles = getUserRolesFromJwtPayload(payload)
    if (!payload.role && payload.roles.length) payload.role = payload.roles[0]

    req.user = payload
    next()
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// ✅ middleware factory supports multi-role (trim-safe)
exports.requireRole = (...roles) => {
  const allow = roles.map(normalizeRole).filter(Boolean)
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const myRoles = Array.isArray(req.user.roles) ? req.user.roles : []
    const single = req.user.role ? [req.user.role] : []
    const all = [...new Set([...myRoles, ...single].map(normalizeRole).filter(Boolean))]

    if (!all.some((r) => allow.includes(r))) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    next()
  }
}
