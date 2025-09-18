// backend/middlewares/auth.js
const jwt = require('jsonwebtoken')

exports.requireAuth = (req, res, next) => {
  const hdr = req.headers.authorization || ''
  const [type, token] = hdr.split(' ')
  if (type !== 'Bearer' || !token) return res.status(401).json({ message: 'Unauthorized' })
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' })
  next()
}
