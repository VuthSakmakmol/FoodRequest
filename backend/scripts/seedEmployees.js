// scripts/seedEmployees.js
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

// Default JSON input path: backend/staff1.json
const DEFAULT_JSON = path.resolve(__dirname, '../staff1.json')
const ARG_PATH = process.argv[2] ? path.resolve(process.argv[2]) : null
const INPUT_PATH = ARG_PATH || DEFAULT_JSON

/* ───────── Normalize helper ───────── */
function normalizeRow(row) {
  // ID
  const employeeId = String(
    row.employeeId ?? row.EmployeeID ?? row.EMPLOYEE_ID ?? row.ID ?? row.Id ?? ''
  ).trim()

  // Name
  const name = (
    row.name ?? row.Name ?? row.FullName ?? row['Full Name'] ?? row['Employee Name'] ?? ''
  )
    .toString()
    .trim()

  // Department
  const department = (
    row.department ?? row.Department ?? row.Dept ?? row['Department Name'] ?? 'Unknown'
  )
    .toString()
    .trim()

  // Contact number
  const contactNumber = (
    row.contactNumber ??
    row.ContactNumber ??
    row['Contact Number'] ??
    row.Phone ??
    row.Mobile ??
    row['Phone Number'] ??
    ''
  )
    .toString()
    .trim()

  // Telegram Chat ID
  const telegramChatId = (row.telegramChatId ?? row.TelegramChatId ?? row.telegram ?? '')
    .toString()
    .trim()

  // Active flag
  let isActive = row.isActive ?? row.Active ?? row.active ?? row.Status
  if (typeof isActive === 'string') {
    const v = isActive.toLowerCase().trim()
    isActive = ['true', 'yes', 'active', '1', 'y'].includes(v)
  } else if (typeof isActive === 'number') {
    isActive = isActive !== 0
  } else if (typeof isActive !== 'boolean') {
    isActive = true
  }

  return { employeeId, name, department, contactNumber, isActive, telegramChatId }
}

/* ───────── Load source data ───────── */
function loadEmployees() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Employee JSON file not found: ${INPUT_PATH}`)
  }

  const raw = fs.readFileSync(INPUT_PATH, 'utf8')
  const data = JSON.parse(raw)

  if (!Array.isArray(data)) {
    throw new Error('JSON root must be an array of employees')
  }

  console.log(`📄 Loaded ${data.length} rows from ${INPUT_PATH}`)
  return data.map(normalizeRow)
}

/* ───────── Seeding runner ───────── */
async function seed() {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  const rawEmployees = loadEmployees()

  const employees = []
  const skipped = []

  for (const row of rawEmployees) {
    const emp = normalizeRow(row)
    if (!emp.employeeId || !emp.name) {
      skipped.push({ row, reason: 'Missing employeeId or name' })
      continue
    }
    employees.push(emp)
  }

  if (!employees.length) {
    console.error('❌ No valid employees to seed.')
    if (skipped.length) console.error('Skipped examples:', skipped.slice(0, 3))
    await mongoose.disconnect()
    process.exit(1)
  }

  const ops = employees.map((emp) => ({
    updateOne: {
      filter: { employeeId: emp.employeeId },
      update: { $set: emp },
      upsert: true,
    },
  }))

  console.log(`🧱 Upserting ${ops.length} employees...`)
  const res = await EmployeeDirectory.bulkWrite(ops, { ordered: false })

  console.log('✅ Bulk result:', {
    matched: res.matchedCount,
    modified: res.modifiedCount,
    upserted:
      res.upsertedCount || (res.upsertedIds ? Object.keys(res.upsertedIds).length : 0),
  })

  if (skipped.length) {
    console.log(`⚠️ Skipped ${skipped.length} rows (showing up to 5):`)
    for (const s of skipped.slice(0, 5)) {
      console.log(' - reason:', s.reason, ' row:', s.row)
    }
  }

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
