/* eslint-disable no-console */
// backend/scripts/fixLeaveRawBalances.js

const mongoose = require('mongoose')
require('dotenv').config()

const { recalculateAllProfiles } = require('../services/leave/leave.recalculate.service')

function s(v) {
  return String(v ?? '').trim()
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(MONGO_URI)
  console.log('✅ MongoDB connected')

  const onlyEmployeeId = s(process.argv[2] || '')
  const filter = onlyEmployeeId ? { employeeId: onlyEmployeeId } : {}

  const result = await recalculateAllProfiles({
    filter,
    asOfDate: new Date(),
    log: true,
  })

  console.log(
    `\nDone. Total=${result.total}, Fixed=${result.fixed}, Failed=${result.failed}`
  )

  await mongoose.disconnect()
  console.log('👋 MongoDB disconnected')
}

main().catch(async (err) => {
  console.error('❌ Script error:', err)
  try {
    await mongoose.disconnect()
  } catch (_) {}
  process.exit(1)
})