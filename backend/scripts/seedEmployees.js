// backend/scripts/seedEmployee.js
/* eslint-disable no-console */

const path = require('path')
const fs = require('fs')
const mongoose = require('mongoose')
const dotenv = require('dotenv')

// ✅ Load backend/.env safely even when running from backend/scripts
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
})

const EmployeeDirectory = require('../models/EmployeeDirectory')
const User = require('../models/User')

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

/*
|--------------------------------------------------------------------------
| Usage
|--------------------------------------------------------------------------
| node .\scripts\seedEmployee.js
| node .\scripts\seedEmployee.js .\data\employees.json
| node .\scripts\seedEmployee.js --prune
|
| --prune = delete EmployeeDirectory records from MongoDB
|           if they are not in JSON.
|
| IMPORTANT:
| - This script creates/updates EmployeeDirectory.
| - This script only updates existing Users.
| - It does NOT create new users from JSON.
| - It only updates User.employeeId, User.name, User.telegramChatId.
*/

const args = process.argv.slice(2)

const SHOULD_PRUNE =
  args.includes('--prune') ||
  String(process.env.SEED_EMPLOYEE_PRUNE || '').toLowerCase() === 'true'

const VERIFY_AFTER_SAVE = !args.includes('--no-verify')

const jsonArg = args.find((a) => !String(a || '').startsWith('--'))

const DEFAULT_JSON = path.resolve(__dirname, '../data/employees.json')
const INPUT_PATH = jsonArg ? path.resolve(process.cwd(), jsonArg) : DEFAULT_JSON

function cleanString(v) {
  return String(v ?? '').trim()
}

function normalizePhone(v) {
  return cleanString(v).replace(/-/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeBoolean(v, fallback = true) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0

  if (typeof v === 'string') {
    const val = v.toLowerCase().trim()

    if (['true', 'yes', 'active', '1', 'y'].includes(val)) return true
    if (['false', 'no', 'inactive', '0', 'n'].includes(val)) return false
  }

  return fallback
}

function hasEmployeeSchemaPath(field) {
  return Boolean(EmployeeDirectory.schema.path(field))
}

function hasUserSchemaPath(field) {
  return Boolean(User.schema.path(field))
}

function pickFirst(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null) return value
  }

  return fallback
}

function normalizeRow(row) {
  const employeeId = cleanString(
    pickFirst(row, ['employeeId', 'EmployeeID', 'EMPLOYEE_ID', 'ID', 'Id']),
  )

  const name = cleanString(
    pickFirst(row, ['name', 'Name', 'FullName', 'Full Name', 'Employee Name']),
  )

  const department =
    cleanString(
      pickFirst(row, ['department', 'Department', 'Dept', 'Department Name'], 'Unknown'),
    ) || 'Unknown'

  const position =
    cleanString(
      pickFirst(row, ['position', 'Position', 'JobTitle', 'Job Title', 'Title']),
    ) || 'NA'

  const contactNumber = normalizePhone(
    pickFirst(row, [
      'contactNumber',
      'ContactNumber',
      'Contact Number',
      'Phone',
      'Mobile',
      'Phone Number',
    ]),
  )

  const telegramChatId = cleanString(
    pickFirst(row, ['telegramChatId', 'TelegramChatId', 'telegram', 'Telegram']),
  )

  const telegramUsername = cleanString(
    pickFirst(row, ['telegramUsername', 'TelegramUsername', 'telegramUserName']),
  )

  const isActive = normalizeBoolean(
    pickFirst(row, ['isActive', 'Active', 'active', 'Status'], true),
    true,
  )

  return {
    employeeId,
    name,
    department,
    position,
    contactNumber,
    telegramChatId,
    telegramUsername,
    isActive,
  }
}

function loadEmployees() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`❌ JSON not found: ${INPUT_PATH}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(INPUT_PATH, 'utf8')
  const data = JSON.parse(raw)

  if (!Array.isArray(data)) {
    throw new Error('JSON root must be an array of employees')
  }

  console.log(`📄 Loaded ${data.length} rows from ${INPUT_PATH}`)

  const seen = new Map()
  const skipped = []
  const duplicateIds = []

  for (const row of data) {
    const emp = normalizeRow(row)

    if (!emp.employeeId || !emp.name) {
      skipped.push({
        employeeId: emp.employeeId || '',
        name: emp.name || '',
        reason: 'Missing employeeId or name',
      })
      continue
    }

    if (seen.has(emp.employeeId)) {
      duplicateIds.push(emp.employeeId)
      console.warn(`⚠️ Duplicate employeeId in JSON, last one will win: ${emp.employeeId}`)
    }

    seen.set(emp.employeeId, emp)
  }

  return {
    employees: [...seen.values()],
    skipped,
    duplicateIds,
  }
}

function buildEmployeePayload(emp) {
  const payload = {}

  if (hasEmployeeSchemaPath('employeeId')) payload.employeeId = emp.employeeId
  if (hasEmployeeSchemaPath('name')) payload.name = emp.name
  if (hasEmployeeSchemaPath('department')) payload.department = emp.department
  if (hasEmployeeSchemaPath('position')) payload.position = emp.position

  // ✅ Avoid contactNumber validation error when JSON has blank contactNumber
  if (hasEmployeeSchemaPath('contactNumber') && emp.contactNumber) {
    payload.contactNumber = emp.contactNumber
  }

  if (hasEmployeeSchemaPath('telegramChatId')) payload.telegramChatId = emp.telegramChatId
  if (hasEmployeeSchemaPath('telegramUsername')) payload.telegramUsername = emp.telegramUsername
  if (hasEmployeeSchemaPath('isActive')) payload.isActive = emp.isActive

  return payload
}

function setEmployeeStringIfChanged(doc, field, value, changedFields) {
  if (!hasEmployeeSchemaPath(field)) return false

  const current = cleanString(doc[field])
  const next = cleanString(value)

  if (current !== next) {
    doc[field] = next
    changedFields.push(field)
    return true
  }

  return false
}

function setEmployeeOptionalStringIfChanged(doc, field, value, changedFields) {
  if (!hasEmployeeSchemaPath(field)) return false

  const current = cleanString(doc[field])
  const next = cleanString(value)

  if (current !== next) {
    doc[field] = next || undefined
    changedFields.push(field)
    return true
  }

  return false
}

function setEmployeeBooleanIfChanged(doc, field, value, changedFields) {
  if (!hasEmployeeSchemaPath(field)) return false

  const current = Boolean(doc[field])
  const next = Boolean(value)

  if (current !== next) {
    doc[field] = next
    changedFields.push(field)
    return true
  }

  return false
}

function setUserStringIfChanged(doc, field, value, changedFields) {
  if (!hasUserSchemaPath(field)) return false

  const current = cleanString(doc[field])
  const next = cleanString(value)

  if (current !== next) {
    doc[field] = next
    changedFields.push(field)
    return true
  }

  return false
}

async function findEmployee(employeeId) {
  const cleanId = cleanString(employeeId)

  if (!cleanId) return null

  return EmployeeDirectory.findOne({ employeeId: cleanId })
}

async function verifyEmployeeSaved(emp) {
  if (!VERIFY_AFTER_SAVE) return true

  const saved = await EmployeeDirectory.findOne({ employeeId: emp.employeeId }).lean()

  if (!saved) {
    console.warn(`⚠️ Verify failed: not found after save employeeId=${emp.employeeId}`)
    return false
  }

  const checks = []

  if (hasEmployeeSchemaPath('name')) {
    checks.push(['name', cleanString(saved.name), emp.name])
  }

  if (hasEmployeeSchemaPath('department')) {
    checks.push(['department', cleanString(saved.department), emp.department])
  }

  if (hasEmployeeSchemaPath('position')) {
    checks.push(['position', cleanString(saved.position), emp.position])
  }

  if (hasEmployeeSchemaPath('contactNumber')) {
    checks.push(['contactNumber', cleanString(saved.contactNumber), emp.contactNumber])
  }

  if (hasEmployeeSchemaPath('telegramChatId')) {
    checks.push(['telegramChatId', cleanString(saved.telegramChatId), emp.telegramChatId])
  }

  if (hasEmployeeSchemaPath('telegramUsername')) {
    checks.push(['telegramUsername', cleanString(saved.telegramUsername), emp.telegramUsername])
  }

  if (hasEmployeeSchemaPath('isActive')) {
    checks.push(['isActive', Boolean(saved.isActive), Boolean(emp.isActive)])
  }

  const failed = checks.filter(([, current, expected]) => current !== expected)

  if (failed.length) {
    console.warn(`⚠️ Verify mismatch employeeId=${emp.employeeId}`)

    for (const [field, current, expected] of failed) {
      console.warn(`   - ${field}: DB="${current}" JSON="${expected}"`)
    }

    return false
  }

  return true
}

async function verifyUserSaved(emp, userId) {
  if (!VERIFY_AFTER_SAVE) return true

  const saved = await User.findById(userId).lean()

  if (!saved) {
    console.warn(`⚠️ User verify failed: not found after save employeeId=${emp.employeeId}`)
    return false
  }

  const checks = []

  if (hasUserSchemaPath('employeeId')) {
    checks.push(['employeeId', cleanString(saved.employeeId), emp.employeeId])
  }

  if (hasUserSchemaPath('name')) {
    checks.push(['name', cleanString(saved.name), emp.name])
  }

  if (hasUserSchemaPath('telegramChatId')) {
    checks.push(['telegramChatId', cleanString(saved.telegramChatId), emp.telegramChatId])
  }

  const failed = checks.filter(([, current, expected]) => current !== expected)

  if (failed.length) {
    console.warn(`⚠️ User verify mismatch employeeId=${emp.employeeId}`)

    for (const [field, current, expected] of failed) {
      console.warn(`   - ${field}: DB="${current}" JSON="${expected}"`)
    }

    return false
  }

  return true
}

async function upsertEmployeeDirectory(emp) {
  let employee = await findEmployee(emp.employeeId)

  if (!employee) {
    const payload = buildEmployeePayload(emp)

    employee = await EmployeeDirectory.create(payload)

    console.log(`🆕 Created EmployeeDirectory: employeeId=${emp.employeeId}, name=${emp.name}`)

    await verifyEmployeeSaved(emp)

    return {
      employeeCreated: 1,
      employeeUpdated: 0,
      employeeExisted: 0,
    }
  }

  const changedFields = []

  setEmployeeStringIfChanged(employee, 'employeeId', emp.employeeId, changedFields)
  setEmployeeStringIfChanged(employee, 'name', emp.name, changedFields)
  setEmployeeStringIfChanged(employee, 'department', emp.department, changedFields)
  setEmployeeStringIfChanged(employee, 'position', emp.position, changedFields)

  // ✅ Blank contactNumber becomes undefined to avoid regex validation issue
  setEmployeeOptionalStringIfChanged(employee, 'contactNumber', emp.contactNumber, changedFields)

  // ✅ JSON is the master source for Telegram fields.
  // If JSON is empty, DB will also become empty.
  setEmployeeStringIfChanged(employee, 'telegramChatId', emp.telegramChatId, changedFields)
  setEmployeeStringIfChanged(employee, 'telegramUsername', emp.telegramUsername, changedFields)

  setEmployeeBooleanIfChanged(employee, 'isActive', emp.isActive, changedFields)

  if (changedFields.length) {
    await employee.save()

    console.log(
      `✏️ Updated EmployeeDirectory: employeeId=${emp.employeeId}, fields=${changedFields.join(', ')}`,
    )

    await verifyEmployeeSaved(emp)

    return {
      employeeCreated: 0,
      employeeUpdated: 1,
      employeeExisted: 0,
    }
  }

  console.log(`✅ EmployeeDirectory exists: employeeId=${emp.employeeId}, name=${emp.name}`)

  return {
    employeeCreated: 0,
    employeeUpdated: 0,
    employeeExisted: 1,
  }
}

async function findExistingUserForEmployee(emp) {
  const employeeId = cleanString(emp.employeeId)

  if (!employeeId) {
    return {
      user: null,
      matchedBy: '',
    }
  }

  // ✅ Best match: User.employeeId
  let user = await User.findOne({ employeeId })

  if (user) {
    return {
      user,
      matchedBy: 'employeeId',
    }
  }

  // ✅ Fallback match: User.loginId
  // This supports old users where loginId = employeeId but employeeId field is blank.
  user = await User.findOne({ loginId: employeeId })

  if (user) {
    return {
      user,
      matchedBy: 'loginId',
    }
  }

  return {
    user: null,
    matchedBy: '',
  }
}

async function updateExistingUserFromEmployee(emp) {
  const { user, matchedBy } = await findExistingUserForEmployee(emp)

  if (!user) {
    console.log(
      `🚫 User not found, skipped user update: employeeId=${emp.employeeId}, name=${emp.name}`,
    )

    return {
      userUpdated: 0,
      userExisted: 0,
      userNotFound: 1,
      userDuplicateEmployeeIdSkipped: 0,
    }
  }

  const changedFields = []
  let duplicateEmployeeIdSkipped = 0

  // ✅ Update User.employeeId safely
  if (hasUserSchemaPath('employeeId')) {
    const currentEmployeeId = cleanString(user.employeeId)
    const nextEmployeeId = cleanString(emp.employeeId)

    if (currentEmployeeId !== nextEmployeeId) {
      const duplicateUser = await User.findOne({
        _id: { $ne: user._id },
        employeeId: nextEmployeeId,
      })
        .select('_id loginId employeeId name')
        .lean()

      if (duplicateUser) {
        duplicateEmployeeIdSkipped = 1

        console.warn(
          `⚠️ Skip User.employeeId update because another user already has employeeId=${nextEmployeeId}`,
        )
        console.warn(
          `   Current user loginId=${user.loginId}, name=${user.name}`,
        )
        console.warn(
          `   Duplicate user loginId=${duplicateUser.loginId}, name=${duplicateUser.name}`,
        )
      } else {
        user.employeeId = nextEmployeeId
        changedFields.push('employeeId')
      }
    }
  }

  // ✅ Update User.name only
  setUserStringIfChanged(user, 'name', emp.name, changedFields)

  // ✅ Update User.telegramChatId only
  // JSON is the master source. If JSON is empty, DB will become empty.
  setUserStringIfChanged(user, 'telegramChatId', emp.telegramChatId, changedFields)

  if (changedFields.length) {
    await user.save()

    console.log(
      `✏️ Updated User: matchedBy=${matchedBy}, loginId=${user.loginId}, employeeId=${emp.employeeId}, fields=${changedFields.join(', ')}`,
    )

    await verifyUserSaved(emp, user._id)

    return {
      userUpdated: 1,
      userExisted: 0,
      userNotFound: 0,
      userDuplicateEmployeeIdSkipped: duplicateEmployeeIdSkipped,
    }
  }

  console.log(
    `✅ User exists no change: matchedBy=${matchedBy}, loginId=${user.loginId}, employeeId=${emp.employeeId}`,
  )

  return {
    userUpdated: 0,
    userExisted: 1,
    userNotFound: 0,
    userDuplicateEmployeeIdSkipped: duplicateEmployeeIdSkipped,
  }
}

async function pruneMissingEmployees(incomingIds) {
  if (!SHOULD_PRUNE) {
    console.log('🛡️ Prune disabled. Missing EmployeeDirectory records will NOT be deleted.')
    console.log('   To delete employees not in JSON, run: node .\\scripts\\seedEmployee.js --prune')
    console.log('   Note: --prune does NOT delete users.')
    return {
      deleted: 0,
    }
  }

  console.log('🧹 Prune enabled. Removing EmployeeDirectory records not present in source JSON...')

  const res = await EmployeeDirectory.deleteMany({
    employeeId: {
      $nin: incomingIds,
    },
  })

  console.log(`🗑️ Deleted missing EmployeeDirectory records: ${res.deletedCount || 0}`)
  console.log('🛡️ Users collection was NOT pruned.')

  return {
    deleted: res.deletedCount || 0,
  }
}

async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...')

    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })

    console.log('✅ MongoDB connected')

    const { employees, skipped, duplicateIds } = loadEmployees()

    console.log(`🧱 Syncing ${employees.length} employees...`)
    console.log('📌 EmployeeDirectory: create/update enabled')
    console.log('📌 Users: update existing only, no user creation')

    const stats = {
      employeeDirectory: {
        created: 0,
        updated: 0,
        existed: 0,
        deleted: 0,
      },
      users: {
        updated: 0,
        existed: 0,
        notFound: 0,
        duplicateEmployeeIdSkipped: 0,
      },
      source: {
        skipped: skipped.length,
        duplicatesInSource: duplicateIds.length,
      },
    }

    for (const emp of employees) {
      const employeeResult = await upsertEmployeeDirectory(emp)

      stats.employeeDirectory.created += employeeResult.employeeCreated
      stats.employeeDirectory.updated += employeeResult.employeeUpdated
      stats.employeeDirectory.existed += employeeResult.employeeExisted

      const userResult = await updateExistingUserFromEmployee(emp)

      stats.users.updated += userResult.userUpdated
      stats.users.existed += userResult.userExisted
      stats.users.notFound += userResult.userNotFound
      stats.users.duplicateEmployeeIdSkipped += userResult.userDuplicateEmployeeIdSkipped
    }

    const incomingIds = employees.map((e) => e.employeeId)
    const pruneResult = await pruneMissingEmployees(incomingIds)

    stats.employeeDirectory.deleted = pruneResult.deleted

    if (skipped.length) {
      console.warn('⚠️ Skipped source rows:')

      for (const item of skipped.slice(0, 20)) {
        console.warn(item)
      }

      if (skipped.length > 20) {
        console.warn(`...and ${skipped.length - 20} more skipped rows`)
      }
    }

    console.log('✅ Seed result:')
    console.log(JSON.stringify(stats, null, 2))

    console.log('🎉 Done seeding employees and updating existing users.')
  } catch (err) {
    console.error('❌ Error in seedEmployee:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()