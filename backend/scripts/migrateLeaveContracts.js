/* eslint-disable no-console */
//backend/scripts/migrateLeaveContracts.js
require('dotenv').config()
const mongoose = require('mongoose')
const LeaveProfile = require('../models/leave/LeaveProfile')

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

async function run() {
  const MONGO_URI = process.env.MONGO_URI
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI is missing in your .env')
    process.exit(1)
  }

  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined })
  console.log('✅ MongoDB connected')

  const docs = await LeaveProfile.find({})
  let updated = 0

  for (const doc of docs) {
    if (Array.isArray(doc.contracts) && doc.contracts.length > 0) continue

    const start =
      doc.contractDate && isValidYMD(doc.contractDate)
        ? doc.contractDate
        : doc.joinDate && isValidYMD(doc.joinDate)
          ? doc.joinDate
          : ''

    doc.contracts = [
      {
        contractNo: 1,
        startDate: start,
        endDate: '',
        openedAt: new Date(),
        closedAt: null,
        openedBy: 'migration',
        closedBy: '',
        note: 'Initial contract (migration)',
        closeSnapshot: null,
      },
    ]

    await doc.save()
    updated += 1
  }

  console.log(`🎉 Done. Updated profiles: ${updated}`)
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((e) => {
  console.error('❌ Migration error:', e)
  process.exit(1)
})
