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

const DEFAULT_USER_PWD = process.env.EXPAT_DEFAULT_PASSWORD || process.env.USER_DEFAULT_PASSWORD || '123456'
const DEFAULT_GM_PWD = process.env.LEAVE_GM_DEFAULT_PASSWORD || DEFAULT_USER_PWD
const DEFAULT_LEAVE_ADMIN_PWD = process.env.LEAVE_ADMIN_DEFAULT_PASSWORD || DEFAULT_USER_PWD

const LEAVE_ADMIN_CONFIG = {
  loginId: 'leave_admin',
  name: 'Leave Admin',
  password: DEFAULT_LEAVE_ADMIN_PWD,
  telegramChatId: '899957340',
}

const GM_CONFIG = {
  loginId: 'leave_gm',
  name: 'Expat GM',
  password: DEFAULT_GM_PWD,
  telegramChatId: '7163451169',
}

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
      telegramChatId: String(telegramChatId || '').trim(),
    })
    console.log(`🆕 Created ${role}: ${cleanLoginId}`)
    return user
  }

  let changed = false
  if (name && user.name !== name) { user.name = name; changed = true }
  if (user.role !== role) { user.role = role; changed = true }
  if (!user.isActive) { user.isActive = true; changed = true }

  const chat = String(telegramChatId || '').trim()
  if (chat && String(user.telegramChatId || '') !== chat) {
    user.telegramChatId = chat
    changed = true
  }

  if (changed) {
    await user.save()
    console.log(`✏️ Updated ${role}: ${cleanLoginId}`)
  } else {
    console.log(`✅ ${role} exists: ${cleanLoginId}`)
  }

  return user
}

async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined })
    console.log('✅ MongoDB connected')

    await upsertUser({ ...LEAVE_ADMIN_CONFIG, role: 'LEAVE_ADMIN' })
    await upsertUser({ ...GM_CONFIG, role: 'LEAVE_GM' })

    console.log('🎉 Leave approvers seeding completed (LEAVE_ADMIN + LEAVE_GM).')
  } catch (e) {
    console.error('❌ seedLeaveApprovers error:', e)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()
