// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')

function userRoles(user) {
  const arr = Array.isArray(user?.roles) ? user.roles : []
  const one = user?.role ? [user.role] : []
  return [...new Set([...arr, ...one].map((r) => String(r || '').toUpperCase().trim()).filter(Boolean))]
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

  console.log('[AUTH] signToken roles=', roles, 'primary=', primary)

  return jwt.sign(
    {
      sub: String(user._id),
      id: String(user.loginId), // legacy
      loginId: String(user.loginId),
      name: user.name || '',
      role: primary,
      roles,

      passwordVersion: Number(user.passwordVersion || 0),
    },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d', issuer: 'food-app', audience: 'food-web' }
  )
}

// Map portals -> allowed roles
const PORTAL_ROLES = {
  chef: new Set(['CHEF', 'ADMIN', 'ROOT_ADMIN']),
  leave: new Set(['LEAVE_USER', 'LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_ADMIN', 'LEAVE_COO', 'ADMIN', 'ROOT_ADMIN']),

  // ✅ add these
  transport: new Set(['ADMIN', 'ROOT_ADMIN', 'DRIVER', 'MESSENGER']),
  admin: new Set(['ADMIN', 'ROOT_ADMIN']),  // if your transport admin UI uses portal=admin
  food: new Set(['ADMIN', 'ROOT_ADMIN', 'EMPLOYEE']), // optional if you have food employee portal
}


exports.login = async (req, res, next) => {
  console.log('\n[AUTH] HIT login', req.method, req.originalUrl)
  try {
    const portal = (req.body?.portal || req.headers['x-portal'] || '')
      .toString()
      .trim()
      .toLowerCase()

    const rawId = req.body?.loginId ?? ''
    const password = req.body?.password ?? ''
    const loginId = String(rawId).trim()

    console.log('[AUTH] portal=', portal || '(none)', 'loginId=', loginId)

    if (!loginId || !password) {
      console.log('[AUTH] missing credentials')
      return res.status(400).json({ message: 'loginId and password required' })
    }

    const user = await User.findOne({ loginId })
    console.log('[AUTH] user found?', !!user)

    if (!user) return res.status(401).json({ message: 'Invalid credentials' })
    if (user.isActive === false) return res.status(403).json({ message: 'Account disabled' })

    const ok = await user.verifyPassword(password)
    console.log('[AUTH] password ok?', ok)

    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

    const roles = userRoles(user)
    console.log('[AUTH] roles=', roles)

    // ✅ portal allow
    if (portal) {
      const allowed = PORTAL_ROLES[portal]
      if (!allowed) {
        console.log('[AUTH] unknown portal:', portal)
        return res.status(400).json({ message: 'Unknown portal' })
      }

      const can = roles.some((r) => allowed.has(r))
      console.log('[AUTH] portal allowed?', can)

      if (!can) return res.status(403).json({ message: 'Not allowed for this portal' })
    }

    const token = signToken(user)
    const primary = pickPrimaryRole(roles) || roles[0] || user.role || ''

    console.log('[AUTH] ✅ LOGIN OK primary=', primary)

    return res.json({
      token,
      user: {
        id: String(user.loginId),
        loginId: String(user.loginId),
        name: user.name,
        role: primary,
        roles,
        passwordVersion: Number(user.passwordVersion || 0),
      },
      portal: portal || null,
    })
  } catch (e) {
    console.log('[AUTH] ERROR in login:', e?.message)
    next(e)
  }
}

exports.createUser = async (req, res, next) => {
  console.log('\n[AUTH] HIT createUser', req.method, req.originalUrl)
  try {
    const { loginId, name, password, role, roles, telegramChatId: bodyChatId } = req.body || {}

    if (!loginId || !name || !password) {
      return res.status(400).json({ message: 'loginId, name, password required' })
    }

    const cleanId = String(loginId).trim()
    const exists = await User.findOne({ loginId: cleanId })
    if (exists) return res.status(409).json({ message: 'loginId already exists' })

    const rolesArr = (Array.isArray(roles) ? roles : roles ? [roles] : role ? [role] : ['LEAVE_USER'])
      .map((r) => String(r || '').toUpperCase().trim())
      .filter(Boolean)

    const merged = [...new Set(rolesArr)]
    const mainRole = pickPrimaryRole(merged) || merged[0] || 'LEAVE_USER'

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
      role: mainRole,
      roles: merged,
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
    console.log('[AUTH] ERROR in createUser:', e?.message)
    next(e)
  }
}

exports.me = async (req, res, next) => {
  console.log('\n[AUTH] HIT me', req.method, req.originalUrl, 'user=', req.user?.loginId)
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
    console.log('[AUTH] ERROR in me:', e?.message)
    next(e)
  }
}

exports.changePassword = async (req, res, next) => {
  try {
    const userId = req.user?.sub
    const oldPassword = String(req.body?.oldPassword || '')
    const newPassword = String(req.body?.newPassword || '')

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'oldPassword and newPassword required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' })
    }
    if (newPassword === oldPassword) {
      return res.status(400).json({ message: 'New password must be different from old password' })
    }

    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ message: 'Not found' })
    if (user.isActive === false) return res.status(403).json({ message: 'Account disabled' })

    const ok = await user.verifyPassword(oldPassword)
    if (!ok) return res.status(400).json({ message: 'Old password is incorrect' })

    // ✅ bump version -> revoke sessions
    await user.setPassword(newPassword)
    await user.save()

    return res.json({ ok: true, message: 'Password updated. Please login again.' })
  } catch (e) {
    next(e)
  }
}