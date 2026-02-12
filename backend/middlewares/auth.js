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

    if (!payload.loginId && payload.id) payload.loginId = payload.id

    payload.roles = getUserRolesFromJwtPayload(payload)
    if (!payload.role && payload.roles.length) payload.role = payload.roles[0]

    console.log('[MW] requireAuth user=', payload.loginId, 'roles=', payload.roles)

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
      console.log('[MW] requireRole ❌ FORBIDDEN (missing role). allow=', allow, 'has=', all)
      return res.status(403).json({ message: 'Forbidden' })
    }

    console.log('[MW] requireRole ✅ OK')
    next()
  }
}
