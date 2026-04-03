// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')

function s(v) {
  return String(v ?? '').trim()
}

function userRoles(user) {
  const arr = Array.isArray(user?.roles) ? user.roles : []
  const one = user?.role ? [user.role] : []
  return [...new Set([...arr, ...one].map((r) => s(r).toUpperCase()).filter(Boolean))]
}

function pickPrimaryRole(roles = []) {
  const PRIORITY = [
    'LEAVE_ADMIN',
    'LEAVE_COO',
    'LEAVE_GM',
    'LEAVE_MANAGER',
    'LEAVE_USER',
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

function serializeUser(user) {
  const roles = userRoles(user)
  const primary = pickPrimaryRole(roles) || s(user?.role).toUpperCase()

  return {
    id: String(user?._id || user?.loginId || ''),
    loginId: s(user?.loginId),
    employeeId: s(user?.employeeId), // ✅ NEW
    name: s(user?.name),
    role: primary,
    roles,
    isActive: user?.isActive !== false,
    passwordVersion: Number(user?.passwordVersion || 0),
    telegramChatId: s(user?.telegramChatId),
  }
}

const signToken = (user) => {
  const safeUser = serializeUser(user)

  console.log('[AUTH] signToken roles=', safeUser.roles, 'primary=', safeUser.role)

  return jwt.sign(
    {
      sub: String(user._id),
      id: String(safeUser.loginId), // legacy
      loginId: String(safeUser.loginId),
      employeeId: String(safeUser.employeeId || ''), // ✅ NEW
      name: safeUser.name,
      role: safeUser.role,
      roles: safeUser.roles,
      passwordVersion: Number(safeUser.passwordVersion || 0),
    },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d', issuer: 'food-app', audience: 'food-web' }
  )
}

// Map portals -> allowed roles
const PORTAL_ROLES = {
  chef: new Set(['CHEF', 'ADMIN', 'ROOT_ADMIN']),
  leave: new Set([
    'LEAVE_USER',
    'LEAVE_MANAGER',
    'LEAVE_GM',
    'LEAVE_ADMIN',
    'LEAVE_COO',
    'ADMIN',
    'ROOT_ADMIN',
  ]),
  transport: new Set(['ADMIN', 'ROOT_ADMIN', 'DRIVER', 'MESSENGER']),
  admin: new Set(['ADMIN', 'ROOT_ADMIN']),
  food: new Set(['ADMIN', 'ROOT_ADMIN', 'EMPLOYEE']),
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
    const safeUser = serializeUser(user)

    console.log('[AUTH] ✅ LOGIN OK primary=', safeUser.role)

    return res.json({
      token,
      user: safeUser,
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
    const {
      loginId,
      employeeId,
      name,
      password,
      role,
      roles,
      telegramChatId: bodyChatId,
    } = req.body || {}

    if (!loginId || !name || !password) {
      return res.status(400).json({ message: 'loginId, name, password required' })
    }

    const cleanId = s(loginId)
    const cleanEmployeeId = s(employeeId)

    const exists = await User.findOne({ loginId: cleanId })
    if (exists) return res.status(409).json({ message: 'loginId already exists' })

    const rolesArr = (Array.isArray(roles) ? roles : roles ? [roles] : role ? [role] : ['LEAVE_USER'])
      .map((r) => s(r).toUpperCase())
      .filter(Boolean)

    const merged = [...new Set(rolesArr)]
    const mainRole = pickPrimaryRole(merged) || merged[0] || 'LEAVE_USER'

    let telegramChatId = s(bodyChatId)

    if (!telegramChatId) {
      const lookupEmployeeId = cleanEmployeeId || cleanId
      const emp = await EmployeeDirectory.findOne({ employeeId: lookupEmployeeId })
        .select('telegramChatId')
        .lean()
      telegramChatId = s(emp?.telegramChatId)
    }

    const passwordHash = await bcrypt.hash(String(password), 10)

    const doc = await User.create({
      loginId: cleanId,
      employeeId: cleanEmployeeId, // ✅ NEW
      name: s(name),
      passwordHash,
      role: mainRole,
      roles: merged,
      isActive: true,
      ...(telegramChatId ? { telegramChatId } : {}),
    })

    return res.status(201).json(serializeUser(doc))
  } catch (e) {
    console.log('[AUTH] ERROR in createUser:', e?.message)
    next(e)
  }
}

exports.me = async (req, res, next) => {
  console.log('\n[AUTH] HIT me', req.method, req.originalUrl, 'user=', req.user?.loginId)
  try {
    const user = await User.findById(req.user.sub).select(
      'loginId employeeId name role roles isActive passwordVersion telegramChatId'
    )

    if (!user) return res.status(404).json({ message: 'Not found' })

    return res.json(serializeUser(user))
  } catch (e) {
    console.log('[AUTH] ERROR in me:', e?.message)
    next(e)
  }
}

function validatePasswordPolicy(pw) {
  const s1 = String(pw || '')

  const rules = {
    minLen: s1.length >= 13,
    upper: /[A-Z]/.test(s1),
    lower: /[a-z]/.test(s1),
    number: /[0-9]/.test(s1),
    symbol: /[^A-Za-z0-9]/.test(s1),
    noSpace: !/\s/.test(s1),
  }

  const ok = Object.values(rules).every(Boolean)

  const missing = []
  if (!rules.minLen) missing.push('at least 13 characters')
  if (!rules.upper) missing.push('1 uppercase letter')
  if (!rules.lower) missing.push('1 lowercase letter')
  if (!rules.number) missing.push('1 number')
  if (!rules.symbol) missing.push('1 symbol')
  if (!rules.noSpace) missing.push('no spaces')

  return { ok, rules, message: ok ? '' : `Password must include ${missing.join(', ')}.` }
}

exports.changePassword = async (req, res, next) => {
  console.log('\n[AUTH] HIT changePassword', req.method, req.originalUrl, 'user=', req.user?.loginId)

  try {
    const userId = req.user?.sub
    const oldPassword = String(req.body?.oldPassword || '')
    const newPassword = String(req.body?.newPassword || '')

    console.log('[AUTH] changePassword payload:', {
      hasOld: !!oldPassword,
      hasNew: !!newPassword,
      newLen: newPassword.length,
    })

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'oldPassword and newPassword required' })
    }

    if (newPassword === oldPassword) {
      return res.status(400).json({ message: 'New password must be different from old password' })
    }

    const pol = validatePasswordPolicy(newPassword)
    console.log('[AUTH] policy ok?', pol.ok, pol.rules)
    if (!pol.ok) {
      return res.status(422).json({ message: pol.message, policy: pol.rules })
    }

    const user = await User.findById(userId)
    console.log('[AUTH] user found?', !!user)
    if (!user) return res.status(404).json({ message: 'Not found' })
    if (user.isActive === false) return res.status(403).json({ message: 'Account disabled' })

    const ok = await user.verifyPassword(oldPassword)
    console.log('[AUTH] old password ok?', ok)
    if (!ok) return res.status(400).json({ message: 'Old password is incorrect' })

    await user.setPassword(newPassword)
    await user.save()

    console.log('[AUTH] ✅ password updated')
    return res.json({ ok: true, message: 'Password updated. Please login again.' })
  } catch (e) {
    console.log('[AUTH] ERROR in changePassword:', e?.message)
    next(e)
  }
}