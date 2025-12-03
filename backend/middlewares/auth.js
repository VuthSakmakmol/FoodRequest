// backend/middlewares/auth.js
const jwt = require('jsonwebtoken')

exports.requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1] || req.cookies?.access_token
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'food-app',
      audience: 'food-web',
    })
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// ✅ middleware *factory* that RETURNS a function
exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    next()
  }
}
