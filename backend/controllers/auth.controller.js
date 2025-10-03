//controllers/auth.controller.js

const jwt  = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

const signToken = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, id: user.loginId, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

// controllers/auth.controller.js
exports.login = async (req, res, next) => {
  try {
    const rawId = req.body?.loginId ?? ''
    const password = req.body?.password ?? ''

    const loginId = String(rawId).trim()   // ✅ trim spaces
    if (!loginId || !password) {
      return res.status(400).json({ message: 'loginId and password required' })
    }

    // If you want to allow suspended users to be rejected with a clearer message, do two-step:
    const user = await User.findOne({ loginId }) // ← remove isActive:true to disambiguate OR keep it, see below
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    if (user.isActive === false) {
      return res.status(403).json({ message: 'Account disabled' })
    }

    const ok = await user.verifyPassword(password)
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

    const token = signToken(user)
    res.json({ token, user: { id: user.loginId, name: user.name, role: user.role } })
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
