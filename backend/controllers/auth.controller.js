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

exports.login = async (req, res, next) => {
  try {
    const { loginId, password } = req.body || {}
    if (!loginId || !password) return res.status(400).json({ message: 'loginId and password required' })
    const user = await User.findOne({ loginId, isActive: true })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })
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
