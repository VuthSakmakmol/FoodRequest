/* eslint-disable no-console */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const User = require('../models/User')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

const DEFAULT_USER_PWD =
  process.env.EXPAT_DEFAULT_PASSWORD ||
  process.env.USER_DEFAULT_PASSWORD ||
  '123456'

/* ──────────────────────────────
 * CONFIG SECTION – EDIT THIS
 * ────────────────────────────── */
const LEAVE_ADMIN_CONFIG = {
  loginId: 'leave_admin',
  name: 'Leave Admin',
  password: process.env.LEAVE_ADMIN_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
  telegramChatId: '899957340',
}

const GM_CONFIG = {
  loginId: 'leave_gm',
  name: 'Expat GM',
  password: process.env.LEAVE_GM_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
  telegramChatId: '7163451169',
}
/* ────────────────────────────── */

async function hashPassword(pwd) {
  return bcrypt.hash(String(pwd || DEFAULT_USER_PWD), 10)
}

async function upsertUser({ loginId, name, password, role, telegramChatId }) {
  const cleanLoginId = String(loginId || '').trim()
  if (!cleanLoginId) return null

  let user = await User.findOne({ loginId: cleanLoginId })

  if (!user) {
    const passwordHash = await hashPassword(password)
    user = await User.create({
      loginId: cleanLoginId,
      name: String(name || cleanLoginId),
      passwordHash,
      role,
      isActive: true,
      ...(telegramChatId ? { telegramChatId: String(telegramChatId) } : {}),
    })
    console.log(`🆕 Created ${role}: loginId=${cleanLoginId}`)
    return user
  }

  let changed = false

  if (name && user.name !== name) {
    user.name = name
    changed = true
  }
  if (user.role !== role) {
    user.role = role
    changed = true
  }
  if (!user.isActive) {
    user.isActive = true
    changed = true
  }
  if (
    telegramChatId &&
    String(user.telegramChatId || '') !== String(telegramChatId)
  ) {
    user.telegramChatId = String(telegramChatId)
    changed = true
  }

  if (changed) {
    await user.save()
    console.log(`✏️  Updated ${role}: loginId=${cleanLoginId}`)
  } else {
    console.log(`✅ ${role} exists: loginId=${cleanLoginId}`)
  }

  return user
}

async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })
    console.log('✅ MongoDB connected')

    await upsertUser({
      loginId: LEAVE_ADMIN_CONFIG.loginId,
      name: LEAVE_ADMIN_CONFIG.name,
      password: LEAVE_ADMIN_CONFIG.password,
      role: 'LEAVE_ADMIN',
      telegramChatId: LEAVE_ADMIN_CONFIG.telegramChatId,
    })

    await upsertUser({
      loginId: GM_CONFIG.loginId,
      name: GM_CONFIG.name,
      password: GM_CONFIG.password,
      role: 'LEAVE_GM',
      telegramChatId: GM_CONFIG.telegramChatId,
    })

    console.log('🎉 Seed completed: LEAVE_ADMIN + LEAVE_GM only.')
  } catch (err) {
    console.error('❌ Error in seedLeaveCore:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()
