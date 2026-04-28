// backend/scripts/seedLeave.js
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

const DEFAULT_USER_PWD =
  process.env.EXPAT_DEFAULT_PASSWORD ||
  process.env.USER_DEFAULT_PASSWORD ||
  'TraxApparel@123@'

/* ──────────────────────────────
 * CONFIG – EDIT THIS
 * ────────────────────────────── */
const CORE = {
  leaveAdmin: {
    loginId: 'leave_admin',
    employeeId: 'SYS_LEAVE_ADMIN',
    name: 'Leave Admin',
    role: 'LEAVE_ADMIN',
    password: process.env.LEAVE_ADMIN_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
    telegramChatId: '1248659132',
    // telegramChatId: '7163451169',
  },
  gm: {
    loginId: 'leave_gm',
    employeeId: 'SYS_LEAVE_GM',
    name: 'Leave GM',
    role: 'LEAVE_GM',
    password: process.env.LEAVE_GM_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
    telegramChatId: '1805934121',
    // telegramChatId: '7163451169',
  },
  coo: {
    loginId: 'leave_coo',
    employeeId: 'SYS_LEAVE_COO',
    name: 'COO',
    role: 'LEAVE_COO',
    password: process.env.LEAVE_COO_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
    telegramChatId: '716345116933',
  },
}

// Optional: only used when running "full"
const MANAGERS = [
  // {
  //   loginId: '51820001',
  //   name: 'HR Manager',
  //   password: process.env.LEAVE_MANAGER_DEFAULT_PASSWORD || DEFAULT_USER_PWD,
  //   telegramChatId: '',
  //   employees: ['51821047', '52520351'],
  // },
]
/* ────────────────────────────── */

async function hashPassword(pwd) {
  return bcrypt.hash(String(pwd || DEFAULT_USER_PWD), 10)
}

function cleanString(v) {
  return String(v || '').trim()
}

async function upsertUser({
  loginId,
  employeeId,
  name,
  password,
  role,
  telegramChatId,
}) {
  const cleanLoginId = cleanString(loginId)
  const cleanEmployeeId = cleanString(employeeId)

  if (!cleanLoginId) return null

  let user = await User.findOne({ loginId: cleanLoginId })

  if (!user) {
    const passwordHash = await hashPassword(password)

    const payload = {
      loginId: cleanLoginId,
      name: cleanString(name) || cleanLoginId,
      passwordHash,
      role,
      isActive: true,
    }

    if (cleanEmployeeId) payload.employeeId = cleanEmployeeId
    if (telegramChatId) payload.telegramChatId = cleanString(telegramChatId)

    user = await User.create(payload)
    console.log(`🆕 Created ${role}: loginId=${cleanLoginId}`)
    return user
  }

  let changed = false

  if (cleanString(name) && user.name !== cleanString(name)) {
    user.name = cleanString(name)
    changed = true
  }

  if (role && user.role !== role) {
    user.role = role
    changed = true
  }

  if (!user.isActive) {
    user.isActive = true
    changed = true
  }

  if (cleanEmployeeId && cleanString(user.employeeId) !== cleanEmployeeId) {
    user.employeeId = cleanEmployeeId
    changed = true
  }

  if (
    telegramChatId &&
    cleanString(user.telegramChatId) !== cleanString(telegramChatId)
  ) {
    user.telegramChatId = cleanString(telegramChatId)
    changed = true
  }

  if (changed) {
    await user.save()
    console.log(`✏️ Updated ${role}: loginId=${cleanLoginId}`)
  } else {
    console.log(`✅ ${role} exists: loginId=${cleanLoginId}`)
  }

  return user
}

async function ensureLeaveProfile({
  employeeId,
  managerLoginId,
  gmLoginId,
  cooLoginId,
}) {
  const empId = cleanString(employeeId)
  if (!empId) return

  const empDir = await EmployeeDirectory.findOne({ employeeId: empId }).lean()
  if (!empDir) {
    console.warn(`⚠️ EmployeeDirectory not found: employeeId=${empId}`)
    return
  }

  await upsertUser({
    loginId: empId,
    employeeId: empId,
    name: empDir.name || empId,
    password: DEFAULT_USER_PWD,
    role: 'LEAVE_USER',
    telegramChatId: empDir.telegramChatId || '',
  })

  let prof = await LeaveProfile.findOne({ employeeId: empId })
  if (!prof) {
    await LeaveProfile.create({
      employeeId: empId,
      employeeLoginId: empId,
      managerLoginId,
      gmLoginId,
      cooLoginId,
      isActive: true,
      name: empDir.name || '',
      department: empDir.department || '',
      balances: [],
      contracts: [],
      joinDate: '',
      contractDate: '',
      alCarry: 0,
    })
    console.log(
      `🆕 Created LeaveProfile: employeeId=${empId} → manager=${managerLoginId}, gm=${gmLoginId}, coo=${cooLoginId}`,
    )
    return
  }

  let changed = false

  if (cleanString(prof.managerLoginId) !== cleanString(managerLoginId)) {
    prof.managerLoginId = managerLoginId
    changed = true
  }

  if (cleanString(prof.gmLoginId) !== cleanString(gmLoginId)) {
    prof.gmLoginId = gmLoginId
    changed = true
  }

  if (cleanString(prof.cooLoginId) !== cleanString(cooLoginId)) {
    prof.cooLoginId = cooLoginId
    changed = true
  }

  if (prof.isActive === false) {
    prof.isActive = true
    changed = true
  }

  if (changed) {
    await prof.save()
    console.log(`✏️ Updated LeaveProfile: employeeId=${empId}`)
  } else {
    console.log(`✅ LeaveProfile exists: employeeId=${empId}`)
  }
}

async function seedCore() {
  await upsertUser(CORE.leaveAdmin)
  await upsertUser(CORE.gm)
  await upsertUser(CORE.coo)
}

async function seedFull() {
  await seedCore()

  const gmLoginId = CORE.gm.loginId
  const cooLoginId = CORE.coo.loginId

  if (!Array.isArray(MANAGERS) || MANAGERS.length === 0) {
    console.warn('⚠️ MANAGERS is empty. Full seed will only seed core.')
    return
  }

  for (const mgr of MANAGERS) {
    const mgrLoginId = cleanString(mgr.loginId)
    if (!mgrLoginId) continue

    const mgrDir = await EmployeeDirectory.findOne({ employeeId: mgrLoginId }).lean()

    await upsertUser({
      loginId: mgrLoginId,
      employeeId: mgrLoginId,
      name: mgrDir?.name || mgr.name || mgrLoginId,
      password: mgr.password || DEFAULT_USER_PWD,
      role: 'LEAVE_MANAGER',
      telegramChatId: mgrDir?.telegramChatId || mgr.telegramChatId || '',
    })

    const emps = Array.isArray(mgr.employees) ? mgr.employees : []
    for (const empId of emps) {
      await ensureLeaveProfile({
        employeeId: empId,
        managerLoginId: mgrLoginId,
        gmLoginId,
        cooLoginId,
      })
    }
  }
}

async function run() {
  const mode = cleanString(process.argv[2] || 'core').toLowerCase()

  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })
    console.log('✅ MongoDB connected')

    if (mode === 'full') await seedFull()
    else await seedCore()

    console.log(`🎉 Seed completed (mode=${mode}).`)
  } catch (err) {
    console.error('❌ Error in seedLeave:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()