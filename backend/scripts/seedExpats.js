/* eslint-disable no-console */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const User = require('../models/User')
const EmployeeDirectory = require('../models/EmployeeDirectory')
const LeaveProfile = require('../models/leave/LeaveProfile')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

// Default passwords
const DEFAULT_USER_PWD          = process.env.EXPAT_DEFAULT_PASSWORD || process.env.USER_DEFAULT_PASSWORD || '123456'
const DEFAULT_MANAGER_PWD       = process.env.LEAVE_MANAGER_DEFAULT_PASSWORD || DEFAULT_USER_PWD
const DEFAULT_GM_PWD            = process.env.LEAVE_GM_DEFAULT_PASSWORD || DEFAULT_USER_PWD
const DEFAULT_LEAVE_ADMIN_PWD   = process.env.LEAVE_ADMIN_DEFAULT_PASSWORD || DEFAULT_USER_PWD

/* ──────────────────────────────
 * CONFIG SECTION – EDIT THIS
 * ────────────────────────────── */

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

// const MANAGERS = [
//   {
//     loginId: 'leave_mgr_hr',
//     name: 'HR Manager',
//     password: DEFAULT_MANAGER_PWD,
//     telegramChatId: '7163451169', 
//     employees: ['51821047','52520351', '51510016', '51710019'],
//   },
//   // add more managers here...
// ]

/* ────────────────────────────── */

async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10)
}

/**
 * Upsert a User with given role
 * (LEAVE_ADMIN / LEAVE_GM / LEAVE_MANAGER / LEAVE_USER)
 */
async function upsertUser({ loginId, name, password, role, telegramChatId }) {
  const cleanLoginId = String(loginId || '').trim()
  if (!cleanLoginId) {
    console.warn('⚠️ Skipping user with empty loginId')
    return null
  }

  let user = await User.findOne({ loginId: cleanLoginId })

  if (!user) {
    const passwordHash = await hashPassword(password || DEFAULT_USER_PWD)
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

  if (telegramChatId && String(user.telegramChatId || '') !== String(telegramChatId)) {
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

/** LEAVE_ADMIN */
async function ensureLeaveAdmin() {
  return upsertUser({
    loginId: LEAVE_ADMIN_CONFIG.loginId,
    name: LEAVE_ADMIN_CONFIG.name,
    password: LEAVE_ADMIN_CONFIG.password,
    role: 'LEAVE_ADMIN',
    telegramChatId: LEAVE_ADMIN_CONFIG.telegramChatId,
  })
}

/** LEAVE_GM */
async function ensureGM() {
  if (!GM_CONFIG || !GM_CONFIG.loginId) {
    console.warn('⚠️ GM_CONFIG missing or empty; skip GM seeding')
    return null
  }

  return upsertUser({
    loginId: GM_CONFIG.loginId,
    name: GM_CONFIG.name,
    password: GM_CONFIG.password,
    role: 'LEAVE_GM',
    telegramChatId: GM_CONFIG.telegramChatId,
  })
}

/** LEAVE_MANAGER */
async function ensureManager(mgrCfg) {
  const loginId = String(mgrCfg.loginId || '').trim()
  const name = String(mgrCfg.name || loginId || 'Leave Manager').trim()
  const password = String(mgrCfg.password || DEFAULT_MANAGER_PWD)
  const telegramChatId = mgrCfg.telegramChatId || ''

  return upsertUser({
    loginId,
    name,
    password,
    role: 'LEAVE_MANAGER',
    telegramChatId,
  })
}

/** LEAVE_USER + LeaveProfile mapping */
async function ensureExpatUnderManager({ employeeId, managerLoginId, gmLoginId }) {
  const cleanEmpId = String(employeeId || '').trim()
  if (!cleanEmpId) {
    console.warn('⚠️ Skipping expat: missing employeeId')
    return
  }

  const emp = await EmployeeDirectory.findOne({ employeeId: cleanEmpId }).lean()
  if (!emp) {
    console.warn(`⚠️ EmployeeDirectory not found for employeeId=${cleanEmpId}`)
    return
  }

  const loginId = cleanEmpId
  const name = emp.name || cleanEmpId

  await upsertUser({
    loginId,
    name,
    password: DEFAULT_USER_PWD,
    role: 'LEAVE_USER',
    telegramChatId: emp.telegramChatId || '',
  })

  let profile = await LeaveProfile.findOne({ employeeId: cleanEmpId })

  if (!profile) {
    profile = await LeaveProfile.create({
      employeeId: cleanEmpId,
      employeeLoginId: loginId,
      managerLoginId,
      gmLoginId,
      isActive: true,
    })
    console.log(`🆕 Created LeaveProfile: employeeId=${cleanEmpId} → manager=${managerLoginId}, gm=${gmLoginId}`)
    return
  }

  let changed = false

  if (profile.employeeLoginId !== loginId) {
    profile.employeeLoginId = loginId
    changed = true
  }
  if (profile.managerLoginId !== managerLoginId) {
    profile.managerLoginId = managerLoginId
    changed = true
  }
  if (profile.gmLoginId !== gmLoginId) {
    profile.gmLoginId = gmLoginId
    changed = true
  }
  if (!profile.isActive) {
    profile.isActive = true
    changed = true
  }

  if (changed) {
    await profile.save()
    console.log(`✏️  Updated LeaveProfile: employeeId=${cleanEmpId} → manager=${managerLoginId}, gm=${gmLoginId}`)
  } else {
    console.log(`✅ LeaveProfile exists: employeeId=${cleanEmpId} → manager=${managerLoginId}, gm=${gmLoginId}`)
  }
}

/** MAIN */
async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })
    console.log('✅ MongoDB connected')

    // 0) Leave Admin
    await ensureLeaveAdmin()

    // 1) GM
    const gmUser = await ensureGM()
    if (!gmUser) {
      console.warn('⚠️ No GM created; aborting manager/expat mapping.')
      await mongoose.disconnect()
      process.exit(0)
    }

    // 2) Managers + expats
    if (!MANAGERS.length) {
      console.warn('⚠️ MANAGERS list is empty. Please edit scripts/seedExpats.js and add your managers+expats.')
    }

    for (const mgrCfg of MANAGERS) {
      const mgrUser = await ensureManager(mgrCfg)
      if (!mgrUser) continue

      const managerLoginId = mgrUser.loginId
      const gmLoginId = gmUser.loginId

      const employees = Array.isArray(mgrCfg.employees) ? mgrCfg.employees : []
      for (const employeeId of employees) {
        await ensureExpatUnderManager({ employeeId, managerLoginId, gmLoginId })
      }
    }

    console.log('🎉 Expat/Manager/GM/LeaveAdmin seeding completed.')
  } catch (err) {
    console.error('❌ Error in seedExpats:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()
