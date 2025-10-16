// scripts/seedUsers.js
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {})

    /* ───────── helpers ───────── */
    const hash = (pwd) => bcrypt.hash(pwd, 10)

    async function ensureAdmin() {
      const loginId  = (process.env.ADMIN_LOGIN || 'admin').trim()
      const name     = process.env.ADMIN_NAME || 'Kitchen Admin'
      const password = process.env.ADMIN_PASSWORD || 'Passw0rd!'

      const exists = await User.findOne({ loginId })
      if (exists) { console.log('✅ Admin exists:', loginId); return }

      const passwordHash = await hash(password)
      await User.create({ loginId, name, passwordHash, role: 'ADMIN' })
      console.log('🆕 Admin created:', loginId)
    }

    async function seedUsers(role, list) {
      let created = 0, skipped = 0
      for (const u of list) {
        const loginId = String(u.loginId).trim()
        if (!loginId) continue
        const exists = await User.findOne({ loginId })
        if (exists) { skipped++; continue }
        const passwordHash = await hash(u.password)
        await User.create({
          loginId,
          name: u.name,
          passwordHash,
          role,
          isActive: true
        })
        created++
      }
      console.log(`→ ${role}: created ${created}, skipped ${skipped}`)
    }

    /* ───────── data ───────── */
    const defaultPwd = process.env.USER_DEFAULT_PASSWORD || 'Passw0rd!'

    // ✅ Add your CHEFs here
    const chefs = [
      { loginId: 'chef01', name: 'Chef One', password: defaultPwd },
      { loginId: 'chef02', name: 'Chef Two', password: defaultPwd },
      // add more…
    ]

    const drivers = [
      { loginId: 'driver01', name: 'Driver One',   password: defaultPwd },
      { loginId: 'driver02', name: 'Driver Two',   password: defaultPwd },
      { loginId: 'driver03', name: 'Driver Three', password: defaultPwd },
      { loginId: 'driver04', name: 'Driver Four',  password: defaultPwd },
      { loginId: 'driver05', name: 'Driver Five',  password: defaultPwd },
    ]

    const messengers = [
      { loginId: 'messenger01', name: 'Messenger One',   password: defaultPwd },
      { loginId: 'messenger02', name: 'Messenger Two',   password: defaultPwd },
      { loginId: 'messenger03', name: 'Messenger Three', password: defaultPwd },
      { loginId: 'messenger04', name: 'Messenger Four',  password: defaultPwd },
      { loginId: 'messenger05', name: 'Messenger Five',  password: defaultPwd },
    ]

    /* ───────── run ───────── */
    await ensureAdmin()
    await seedUsers('CHEF', chefs)         // 👈 seed CHEFs here
    await seedUsers('DRIVER', drivers)
    await seedUsers('MESSENGER', messengers)

    console.log('✅ Seeding complete')
    process.exit(0)
  } catch (e) {
    console.error('❌ Seeding error:', e)
    process.exit(1)
  }
})()
