// controllers/auth.controller.js
const jwt  = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

const signToken = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, id: user.loginId, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7h', issuer: 'food-app', audience: 'food-web' }
  )

// Map portals -> allowed roles
const PORTAL_ROLES = {
  chef: new Set(['CHEF', 'ADMIN']), // change to new Set(['CHEF']) if ONLY chefs may enter
}

exports.login = async (req, res, next) => {
  try {
    const portal = (req.body?.portal || req.headers['x-portal'] || '').toString().trim().toLowerCase()

    const rawId = req.body?.loginId ?? ''
    const password = req.body?.password ?? ''

    // normalize: trim & lower to avoid case issues
    const loginId = String(rawId).trim()
    if (!loginId || !password) {
      // Keep messages generic to avoid account enumeration
      return res.status(400).json({ message: 'loginId and password required' })
    }

    // Find by loginId (exact). If you adopt case-insensitive login later, see Model patch below.
    const user = await User.findOne({ loginId })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    if (user.isActive === false) {
      return res.status(403).json({ message: 'Account disabled' })
    }

    const ok = await user.verifyPassword(password)
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

    // If logging into a specific portal, enforce allowed roles
    if (portal) {
      const allowed = PORTAL_ROLES[portal]
      if (!allowed) return res.status(400).json({ message: 'Unknown portal' })
      if (!allowed.has(user.role)) {
        return res.status(403).json({ message: 'Not allowed for this portal' })
      }
    }

    const token = signToken(user)

    // Option A: return in JSON (current behavior)
    return res.json({
      token,
      user: { id: user.loginId, name: user.name, role: user.role },
      portal: portal || null
    })

    /* Option B (cookie-based tokens):
    res.cookie('access_token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000
    })
    return res.json({ user: { id: user.loginId, name: user.name, role: user.role }, portal: portal || null })
    */
  } catch (e) { next(e) }
}



exports.createUser = async (req, res, next) => {
  try {
    const { loginId, name, password, role = 'CHEF' } = req.body || {}
    if (!loginId || !name || !password) return res.status(400).json({ message: 'loginId, name, password required' })
    const exists = await User.findOne({ loginId })
    if (exists) return res.status(409).json({ message: 'loginId already exists' })
    const passwordHash = await bcrypt.hash(password, 10)
    const doc = await User.create({ loginId, name, passwordHash, role })
    res.status(201).json({ id: doc.loginId, name: doc.name, role: doc.role })
  } catch (e) { next(e) }
}

exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('loginId name role isActive')
    if (!user) return res.status(404).json({ message: 'Not found' })
    res.json({ id: user.loginId, name: user.name, role: user.role })
  } catch (e) { next(e) }
}
