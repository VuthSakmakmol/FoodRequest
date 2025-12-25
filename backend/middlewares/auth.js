// backend/middlewares/auth.js
const jwt = require('jsonwebtoken')

function getUserRolesFromJwtPayload(payload) {
  const rolesArr = Array.isArray(payload?.roles) ? payload.roles : []
  const roleOne = payload?.role ? [payload.role] : []
  return [...new Set([...rolesArr, ...roleOne].map(r => String(r || '').toUpperCase()))]
}

exports.requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1] || req.cookies?.access_token
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'food-app',
      audience: 'food-web',
    })

    // normalize roles on payload
    payload.roles = getUserRolesFromJwtPayload(payload)
    if (!payload.role && payload.roles.length) payload.role = payload.roles[0]

    req.user = payload
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// ✅ middleware factory supports multi-role
exports.requireRole = (...roles) => {
  const allow = roles.map(r => String(r || '').toUpperCase())
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const myRoles = Array.isArray(req.user.roles) ? req.user.roles : []
    const single = req.user.role ? [String(req.user.role).toUpperCase()] : []
    const all = [...new Set([...myRoles, ...single])]

    if (!all.some(r => allow.includes(r))) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    next()
  }
}
