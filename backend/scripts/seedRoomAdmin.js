// backend/scripts/seedRoomAdmin.js
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in .env')
  process.exit(1)
}

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function uniq(arr) {
  return Array.from(new Set(arr))
}

function buildRoles({ role, roles = [] }) {
  const one = role ? [up(role)] : []
  const many = Array.isArray(roles) ? roles.map(up) : []
  return uniq([...one, ...many].filter(Boolean))
}

async function hashPassword(password) {
  return bcrypt.hash(String(password || ''), 10)
}

async function upsertUser({
  loginId,
  name,
  role,
  roles = [],
  password,
  telegramChatId = '',
  isActive = true,
}) {
  const cleanLoginId = s(loginId)
  const cleanName = s(name)
  const mergedRoles = buildRoles({ role, roles })
  const primaryRole = mergedRoles[0] || 'EMPLOYEE'

  if (!cleanLoginId) {
    console.log('⚠️ Skip user with empty loginId')
    return
  }

  const existing = await User.findOne({ loginId: cleanLoginId })

  if (!existing) {
    const passwordHash = await hashPassword(password)

    await User.create({
      loginId: cleanLoginId,
      name: cleanName || cleanLoginId,
      passwordHash,
      role: primaryRole,
      roles: mergedRoles,
      isActive: !!isActive,
      telegramChatId: s(telegramChatId),
    })

    console.log(
      `🆕 Created ${primaryRole}: ${cleanLoginId} roles=[${mergedRoles.join(', ')}]${
        telegramChatId ? ` (tg:${telegramChatId})` : ''
      }`
    )
    return
  }

  let changed = false

  if (cleanName && existing.name !== cleanName) {
    existing.name = cleanName
    changed = true
  }

  if (typeof isActive === 'boolean' && existing.isActive !== !!isActive) {
    existing.isActive = !!isActive
    changed = true
  }

  const oldRoles = Array.isArray(existing.roles) ? existing.roles.map(up).sort() : []
  const newRoles = mergedRoles.map(up).sort()

  if (JSON.stringify(oldRoles) !== JSON.stringify(newRoles)) {
    existing.roles = mergedRoles
    changed = true
  }

  if (up(existing.role) !== primaryRole) {
    existing.role = primaryRole
    changed = true
  }

  if (telegramChatId && s(existing.telegramChatId) !== s(telegramChatId)) {
    existing.telegramChatId = s(telegramChatId)
    changed = true
  }

  if (changed) {
    await existing.save()
    console.log(
      `✏️  Updated ${primaryRole}: ${cleanLoginId} roles=[${mergedRoles.join(', ')}]${
        existing.telegramChatId ? ` (tg:${existing.telegramChatId})` : ''
      }`
    )
  } else {
    console.log(
      `✅ Exists ${primaryRole}: ${cleanLoginId} roles=[${mergedRoles.join(', ')}]${
        existing.telegramChatId ? ` (tg:${existing.telegramChatId})` : ''
      }`
    )
  }
}

;(async () => {
  try {
    await mongoose.connect(MONGO_URI, {})
    console.log('✅ Connected to MongoDB')

    const defaultPwd = process.env.USER_DEFAULT_PASSWORD || 'Password@12345678'

    const roomAdmins = [
      {
        loginId: 'room_admin',
        name: 'Room Admin',
        role: 'ROOM_ADMIN',
        password: process.env.ROOM_ADMIN_PASSWORD || defaultPwd,
        telegramChatId: process.env.ROOM_ADMIN_TG_CHAT_ID || '1055055243',
      },
    ]

    const materialAdmins = [
      {
        loginId: 'material_admin',
        name: 'Material Admin',
        role: 'MATERIAL_ADMIN',
        password: process.env.MATERIAL_ADMIN_PASSWORD || defaultPwd,
        telegramChatId: process.env.MATERIAL_ADMIN_TG_CHAT_ID || '7163451169',
      },
    ]

    for (const u of roomAdmins) {
      await upsertUser(u)
    }

    for (const u of materialAdmins) {
      await upsertUser(u)
    }

    console.log('✅ Booking Room admin seeding complete')
    process.exit(0)
  } catch (err) {
    console.error('❌ seedRoomAdmin failed:', err)
    process.exit(1)
  }
})()