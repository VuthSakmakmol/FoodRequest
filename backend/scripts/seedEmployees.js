/* eslint-disable no-console */
const path = require('path')
const fs = require('fs')
const mongoose = require('mongoose')
require('dotenv').config()

const EmployeeDirectory = require('../models/EmployeeDirectory')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

const DEFAULT_JSON = path.resolve(__dirname, '../data/employees.json')
const ARG_PATH = process.argv[2] ? path.resolve(process.argv[2]) : null
const INPUT_PATH = ARG_PATH || DEFAULT_JSON

const PRUNE_MISSING = true

function s(v) {
  return String(v ?? '').trim()
}

function normalizePhone(v) {
  return s(v).replace(/\s+/g, ' ').replace(/-/g, '').trim()
}

function normalizeRow(row) {
  const employeeId = s(
    row.employeeId ?? row.EmployeeID ?? row.EMPLOYEE_ID ?? row.ID ?? row.Id ?? ''
  )

  const name = s(
    row.name ?? row.Name ?? row.FullName ?? row['Full Name'] ?? row['Employee Name'] ?? ''
  )

  const department =
    s(row.department ?? row.Department ?? row.Dept ?? row['Department Name'] ?? 'Unknown') ||
    'Unknown'

  const position = s(
    row.position ?? row.Position ?? row.JobTitle ?? row['Job Title'] ?? row.Title ?? ''
  )

  const contactNumber = normalizePhone(
    row.contactNumber ??
      row.ContactNumber ??
      row['Contact Number'] ??
      row.Phone ??
      row.Mobile ??
      row['Phone Number'] ??
      ''
  )

  const telegramChatId = s(row.telegramChatId ?? row.TelegramChatId ?? row.telegram ?? '')
  const telegramUsername = s(
    row.telegramUsername ?? row.TelegramUsername ?? row.telegramUserName ?? ''
  )

  let isActive = row.isActive ?? row.Active ?? row.active ?? row.Status
  if (typeof isActive === 'string') {
    const val = isActive.toLowerCase().trim()
    isActive = ['true', 'yes', 'active', '1', 'y'].includes(val)
  } else if (typeof isActive === 'number') {
    isActive = isActive !== 0
  } else if (typeof isActive !== 'boolean') {
    isActive = true
  }

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
  if (fs.existsSync(INPUT_PATH)) {
    const raw = fs.readFileSync(INPUT_PATH, 'utf8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) {
      throw new Error('JSON root must be an array of employees')
    }
    console.log(`📄 Loaded ${data.length} rows from ${INPUT_PATH}`)
    return data
  }

  console.error(`❌ JSON not found: ${INPUT_PATH}`)
  process.exit(1)
}

function buildSetData(emp) {
  const setData = {
    name: emp.name,
    department: emp.department,
    position: emp.position,
    contactNumber: emp.contactNumber,
    isActive: emp.isActive,
  }

  // only update telegram fields when source has real value
  if (emp.telegramChatId) {
    setData.telegramChatId = emp.telegramChatId
  }
  if (emp.telegramUsername) {
    setData.telegramUsername = emp.telegramUsername
  }

  return setData
}

async function seed() {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  const rawEmployees = loadEmployees()

  const seen = new Map()
  const skipped = []
  const duplicateIds = []

  for (const row of rawEmployees) {
    const emp = normalizeRow(row)

    if (!emp.employeeId || !emp.name) {
      skipped.push({ row, reason: 'Missing employeeId or name' })
      continue
    }

    if (seen.has(emp.employeeId)) duplicateIds.push(emp.employeeId)
    seen.set(emp.employeeId, emp)
  }

  const validEmployees = [...seen.values()]
  const incomingIds = validEmployees.map((e) => e.employeeId)

  console.log(`🧱 Syncing ${validEmployees.length} employees...`)

  const ops = validEmployees.map((emp) => ({
    updateOne: {
      filter: { employeeId: emp.employeeId },
      update: {
        $set: buildSetData(emp),
        $setOnInsert: { employeeId: emp.employeeId },
      },
      upsert: true,
    },
  }))

  const bulkRes = await EmployeeDirectory.bulkWrite(ops, { ordered: false })

  let deleteRes = { deletedCount: 0 }
  if (PRUNE_MISSING) {
    console.log('🧹 Removing employees not present in source data...')
    deleteRes = await EmployeeDirectory.deleteMany({
      employeeId: { $nin: incomingIds },
    })
  }

  console.log('✅ Sync result:')
  console.log({
    matched: bulkRes.matchedCount || 0,
    modified: bulkRes.modifiedCount || 0,
    upserted:
      bulkRes.upsertedCount ||
      (bulkRes.upsertedIds ? Object.keys(bulkRes.upsertedIds).length : 0),
    deleted: deleteRes.deletedCount || 0,
    duplicatesInSource: duplicateIds.length,
    skipped: skipped.length,
  })

  await mongoose.disconnect()
  console.log('🎉 Done seeding employees.')
}

seed().catch(async (err) => {
  console.error('❌ Error seeding employees:', err)
  try {
    await mongoose.disconnect()
  } catch {}
  process.exit(1)
})