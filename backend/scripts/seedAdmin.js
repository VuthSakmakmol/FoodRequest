require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../models/User')

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {})
    const loginId  = process.env.ADMIN_LOGIN  || 'admin'
    const name     = process.env.ADMIN_NAME   || 'Kitchen Admin'
    const password = process.env.ADMIN_PASSWORD || 'Passw0rd!'

    const exists = await User.findOne({ loginId })
    if (exists) { console.log('Admin exists:', loginId); process.exit(0) }

    const passwordHash = await bcrypt.hash(password, 10)
    await User.create({ loginId, name, passwordHash, role: 'ADMIN' })
    console.log('Admin created:', loginId)
    process.exit(0)
  } catch (e) { console.error(e); process.exit(1) }
})()
