// scripts/seedUsers.js
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {})

    /* ---------- helpers ---------- */
    const hash = (pwd) => bcrypt.hash(pwd, 10)

    // upsert a single user (set telegramChatId if provided)
    async function upsertUser({ loginId, name, role, password, telegramChatId, isActive = true }) {
      const doc = await User.findOne({ loginId })
      if (!doc) {
        const passwordHash = await hash(password)
        await User.create({
          loginId,
          name,
          role,
          passwordHash,
          isActive,
          ...(telegramChatId ? { telegramChatId: String(telegramChatId) } : {}),
        })
        console.log(`🆕 Created ${role}: ${loginId}${telegramChatId ? ` (tg:${telegramChatId})` : ''}`)
        return
      }

      // Update fields if changed (including telegramChatId)
      let changed = false
      if (name && doc.name !== name) { doc.name = name; changed = true }
      if (typeof isActive === 'boolean' && doc.isActive !== isActive) { doc.isActive = isActive; changed = true }
      if (telegramChatId && String(doc.telegramChatId || '') !== String(telegramChatId)) {
        doc.telegramChatId = String(telegramChatId)
        changed = true
      }
      if (changed) {
        await doc.save()
        console.log(`✏️  Updated ${role}: ${loginId}${telegramChatId ? ` (tg:${telegramChatId})` : ''}`)
      } else {
        console.log(`✅ Exists ${role}: ${loginId}${doc.telegramChatId ? ` (tg:${doc.telegramChatId})` : ''}`)
      }
    }

    async function ensureAdmin() {
      const loginId  = process.env.ADMIN_LOGIN || 'admin'
      const name     = process.env.ADMIN_NAME || 'Kitchen Admin'
      const password = process.env.ADMIN_PASSWORD || 'Passw0rd!'

      const exists = await User.findOne({ loginId })
      if (exists) {
        // optionally keep admin’s telegramChatId in ENV ADMIN_TG_CHAT_ID
        if (process.env.ADMIN_TG_CHAT_ID && String(exists.telegramChatId || '') !== String(process.env.ADMIN_TG_CHAT_ID)) {
          exists.telegramChatId = String(process.env.ADMIN_TG_CHAT_ID)
          await exists.save()
          console.log(`✏️  Updated ADMIN tg:${exists.telegramChatId}`)
        } else {
          console.log('✅ Admin exists:', loginId)
        }
        return
      }

      const passwordHash = await hash(password)
      await User.create({ loginId, name, passwordHash, role: 'ADMIN' })
      console.log('🆕 Admin created:', loginId)
    }

    async function seedUsers(role, list) {
      for (const u of list) {
        const loginId = String(u.loginId).trim()
        if (!loginId) continue
        await upsertUser({
          loginId,
          name: u.name,
          role,
          password: u.password,
          telegramChatId: u.telegramChatId, // ← will be set/updated if provided
          isActive: true,
        })
      }
    }

    /* ---------- data ---------- */
    const defaultPwd = process.env.USER_DEFAULT_PASSWORD || 'Passw0rd!'

    // Example chefs
    const chefs = [
      { loginId: 'chef01', name: 'Chef One', password: defaultPwd },
      { loginId: 'chef02', name: 'Chef Two', password: defaultPwd },
    ]

    // 👉 Put driver/messenger chat IDs here when you have them.
    // You said one driver(messenger) chat ID is 537250678 — attach it to the right user(s).
    // If that’s driver01, do this:
    const drivers = [
      { loginId: 'driver01', name: 'Driver One',   password: defaultPwd, telegramChatId: '537250678' },
      { loginId: 'driver02', name: 'Driver Two',   password: defaultPwd },
      { loginId: 'driver03', name: 'Driver Three', password: defaultPwd },
      { loginId: 'driver04', name: 'Driver Four',  password: defaultPwd },
      { loginId: 'driver05', name: 'Driver Five',  password: defaultPwd },
    ]

    // If that same ID is for messenger01 instead, move it here (and remove from driver01):
    const messengers = [
      { loginId: 'messenger01', name: 'Messenger One',   password: defaultPwd /* , telegramChatId: '537250678' */ },
      { loginId: 'messenger02', name: 'Messenger Two',   password: defaultPwd },
      { loginId: 'messenger03', name: 'Messenger Three', password: defaultPwd },
      { loginId: 'messenger04', name: 'Messenger Four',  password: defaultPwd },
      { loginId: 'messenger05', name: 'Messenger Five',  password: defaultPwd },
    ]

    /* ---------- run ---------- */
    await ensureAdmin()
    await seedUsers('CHEF', chefs)
    await seedUsers('DRIVER', drivers)
    await seedUsers('MESSENGER', messengers)

    console.log('✅ Seeding complete')
    process.exit(0)
  } catch (e) {
    console.error('❌ Seeding error:', e)
    process.exit(1)
  }
})()
