/* eslint-disable no-console */

//backend/scripts/seedLeaveTypes.js
require('dotenv').config()
const mongoose  = require('mongoose')
const LeaveType = require('../models/leave/LeaveType')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

/**
 * Core leave types (system-defined)
 *
 * AL = Annual Leave (18 days/year, 1.5 days/month, can go negative via SP)
 * MC = Sick Leave (60 days/year)
 * MA = Maternity Leave (90 days fixed)
 * SP = Special Leave (borrow annual, max 7 days/year)
 * UL = Unpaid Leave (unlimited, no balance)
 */
const CORE_TYPES = [
  {
    code: 'AL',
    name: 'Annual Leave',
    description: 'Annual leave, accrues monthly up to 18 days per year.',
    requiresBalance: true,
    yearlyEntitlement: 18,
    accrualPerMonth: 1.5,
    yearlyLimit: 18,      // max usage per year
    fixedDurationDays: 0,
    allowNegative: true,  // can borrow via SP
    isSystem: true,
    order: 1,
  },
  {
    code: 'MC',
    name: 'Sick Leave (MC)',
    description: 'Medical / sick leave, up to 60 days per year.',
    requiresBalance: true,
    yearlyEntitlement: 60,
    accrualPerMonth: 0,
    yearlyLimit: 60,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    order: 2,
  },
  {
    code: 'MA',
    name: 'Maternity Leave (MA)',
    description: 'Maternity leave – fixed 90 days, taken as one block.',
    requiresBalance: false,     // no accrual, rule-based
    yearlyEntitlement: 90,
    accrualPerMonth: 0,
    yearlyLimit: 90,
    fixedDurationDays: 90,      // 👈 enforce 90 days
    allowNegative: false,
    isSystem: true,
    order: 3,
  },
  {
    code: 'SP',
    name: 'Special Leave (SP)',
    description: 'Special / advanced leave, borrowing from future annual leave. Max 7 days per year.',
    requiresBalance: true,      // still tied to annual logic
    yearlyEntitlement: 7,
    accrualPerMonth: 0,
    yearlyLimit: 7,             // 👈 max 7 days/year
    fixedDurationDays: 0,
    allowNegative: false,       // this itself doesn’t go negative; AL balance does
    isSystem: true,
    order: 4,
  },
  {
    code: 'UL',
    name: 'Unpaid Leave (UL)',
    description: 'Unpaid leave – no balance, no yearly limit.',
    requiresBalance: false,
    yearlyEntitlement: 0,
    accrualPerMonth: 0,
    yearlyLimit: 0,             // unlimited
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    order: 5,
  },
]

async function upsertCoreTypes() {
  for (const t of CORE_TYPES) {
    const { code, ...rest } = t
    const updated = await LeaveType.findOneAndUpdate(
      { code },
      { $set: rest },
      { upsert: true, new: true }
    )

    if (updated.createdAt.getTime() === updated.updatedAt.getTime()) {
      console.log(`🆕 Created leave type: ${code} – ${updated.name}`)
    } else {
      console.log(`✏️  Updated leave type: ${code} – ${updated.name}`)
    }
  }
}

async function run() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    })
    console.log('✅ MongoDB connected')

    await upsertCoreTypes()

    console.log('🎉 Core leave types seeded/updated successfully.')
  } catch (err) {
    console.error('❌ Error in seedLeaveTypes:', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 MongoDB disconnected')
    process.exit(0)
  }
}

run()
