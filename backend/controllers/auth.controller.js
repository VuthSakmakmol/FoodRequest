// controllers/auth.controller.js
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')

function userRoles(user) {
  const arr = Array.isArray(user?.roles) ? user.roles : []
  const one = user?.role ? [user.role] : []
  return [...new Set([...arr, ...one].map(r => String(r || '').toUpperCase()))]
}

/** ✅ Choose a stable “primary role” for legacy UI + routing */
function pickPrimaryRole(roles = []) {
  const PRIORITY = [
    // Leave portal
    'LEAVE_ADMIN',
    'LEAVE_COO',
    'LEAVE_GM',
    'LEAVE_MANAGER',
    'LEAVE_USER',

    // Other portals
    'ROOT_ADMIN',
    'ADMIN',
    'CHEF',
    'DRIVER',
    'MESSENGER',
    'EMPLOYEE',
  ]

  for (const p of PRIORITY) {
    if (roles.includes(p)) return p
  }
  return roles[0] || ''
}

const signToken = (user) => {
  const roles = userRoles(user)
  const primary = pickPrimaryRole(roles) || String(user?.role || '').toUpperCase()

  return jwt.sign(
    {
      sub: String(user._id),

      // ✅ keep your legacy fields
      id: String(user.loginId),        // legacy usage
      loginId: String(user.loginId),   // ✅ consistent usage everywhere
      name: user.name || '',

      role: primary,  // ✅ primary role (legacy)
      roles,          // ✅ multi-role
    },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d', issuer: 'food-app', audience: 'food-web' }
  )
}

// Map portals -> allowed roles
const PORTAL_ROLES = {
  chef: new Set(['CHEF', 'ADMIN']),
  leave: new Set(['LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'LEAVE_COO', 'ADMIN']),
}

exports.login = async (req, res, next) => {
  try {
    const portal = (req.body?.portal || req.headers['x-portal'] || '')
      .toString()
      .trim()
      .toLowerCase()

    const rawId = req.body?.loginId ?? ''
    const password = req.body?.password ?? ''

    const loginId = String(rawId).trim()
    if (!loginId || !password) {
      return res.status(400).json({ message: 'loginId and password required' })
    }

    const user = await User.findOne({ loginId })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })
    if (user.isActive === false) return res.status(403).json({ message: 'Account disabled' })

    const ok = await user.verifyPassword(password)
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

    const roles = userRoles(user)

    // ✅ portal allow: ANY role can enter the portal
    if (portal) {
      const allowed = PORTAL_ROLES[portal]
      if (!allowed) return res.status(400).json({ message: 'Unknown portal' })

      const can = roles.some(r => allowed.has(r))
      if (!can) return res.status(403).json({ message: 'Not allowed for this portal' })
    }

    const token = signToken(user)
    const primary = pickPrimaryRole(roles) || (roles[0] || user.role || '')

    return res.json({
      token,
      user: {
        id: String(user.loginId),
        loginId: String(user.loginId),   // ✅ add for frontend consistency
        name: user.name,
        role: primary,                   // ✅ primary (legacy)
        roles,                           // ✅ multi
      },
      portal: portal || null,
    })
  } catch (e) {
    next(e)
  }
}

exports.createUser = async (req, res, next) => {
  try {
    const {
      loginId,
      name,
      password,

      // ✅ allow either role or roles
      role,
      roles,

      telegramChatId: bodyChatId,
    } = req.body || {}

    if (!loginId || !name || !password) {
      return res.status(400).json({ message: 'loginId, name, password required' })
    }

    const cleanId = String(loginId).trim()
    const exists = await User.findOne({ loginId: cleanId })
    if (exists) return res.status(409).json({ message: 'loginId already exists' })

    // ✅ normalize roles
    const rolesArr = (Array.isArray(roles) ? roles : roles ? [roles] : role ? [role] : ['LEAVE_USER'])
      .map(r => String(r || '').toUpperCase().trim())
      .filter(Boolean)

    const merged = [...new Set(rolesArr)]
    const mainRole = pickPrimaryRole(merged) || merged[0] || 'LEAVE_USER'

    // ✅ auto fetch telegramChatId from EmployeeDirectory if not provided
    let telegramChatId = String(bodyChatId || '').trim()
    if (!telegramChatId) {
      const emp = await EmployeeDirectory.findOne({ employeeId: cleanId })
        .select('telegramChatId')
        .lean()
      telegramChatId = String(emp?.telegramChatId || '').trim()
    }

    const passwordHash = await bcrypt.hash(String(password), 10)

    const doc = await User.create({
      loginId: cleanId,
      name: String(name).trim(),
      passwordHash,
      role: mainRole,   // legacy
      roles: merged,    // ✅ multi roles
      isActive: true,
      ...(telegramChatId ? { telegramChatId } : {}),
    })

    res.status(201).json({
      id: doc.loginId,
      loginId: doc.loginId,
      name: doc.name,
      role: doc.role,
      roles: userRoles(doc),
      telegramChatId: doc.telegramChatId || '',
    })
  } catch (e) {
    next(e)
  }
}

exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('loginId name role roles isActive')
    if (!user) return res.status(404).json({ message: 'Not found' })

    res.json({
      id: user.loginId,
      loginId: user.loginId,
      name: user.name,
      role: pickPrimaryRole(userRoles(user)) || user.role,
      roles: userRoles(user),
    })
  } catch (e) {
    next(e)
  }
}
