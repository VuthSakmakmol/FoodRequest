/* eslint-disable no-console */
const mongoose = require('mongoose')
require('dotenv').config()

const LeaveProfile = require('../models/leave/LeaveProfile')
const LeaveRequest = require('../models/leave/LeaveRequest')
const { computeBalances } = require('../utils/leave.rules')

function s(v) {
  return String(v ?? '').trim()
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}
function ymdToUTCDate(ymd) {
  if (!isValidYMD(ymd)) return null
  const [y, m, d] = s(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}
function contractEndFromStart(startYMD) {
  const [y, m, d] = s(startYMD).split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCFullYear(dt.getUTCFullYear() + 1)
  dt.setUTCDate(dt.getUTCDate() - 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
function latestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null
  const withStart = arr.filter((c) => isValidYMD(c?.startDate))
  if (withStart.length) {
    return withStart.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  }
  return arr.slice().sort((a, b) => num(b.contractNo) - num(a.contractNo))[0] || null
}
function findAL(balances = []) {
  return (Array.isArray(balances) ? balances : []).find(
    (b) => s(b?.leaveTypeCode).toUpperCase() === 'AL'
  )
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

  const profiles = await LeaveProfile.find(filter)
  console.log(`📦 Found ${profiles.length} profile(s)`)

  let fixed = 0
  let failed = 0

  for (const doc of profiles) {
    try {
      const employeeId = s(doc.employeeId)
      const latest = latestContract(doc.contracts || [])

      const approved = await LeaveRequest.find({
        employeeId,
        status: 'APPROVED',
      })
        .sort({ startDate: 1 })
        .lean()

      const asOfDate = isValidYMD(latest?.startDate)
        ? ymdToUTCDate(latest.startDate)
        : new Date()

      const plain = doc.toObject()
      plain.balances = []
      plain.balancesAsOf = ''

      const snap = computeBalances(plain, approved, asOfDate, {
        asOfYMD: isValidYMD(latest?.startDate) ? s(latest.startDate) : undefined,
        contractNo: latest?.contractNo || undefined,
      })

      const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
      const nextAsOf = s(snap?.meta?.asOfYMD || '')
      const nextEnd =
        s(snap?.meta?.contractYear?.endDate || '') ||
        (isValidYMD(latest?.startDate) ? contractEndFromStart(latest.startDate) : '')

      const beforeAL = findAL(doc.balances || [])
      const afterAL = findAL(nextBalances)

      doc.balances = nextBalances
      if (nextAsOf) doc.balancesAsOf = nextAsOf
      if (nextEnd) doc.contractEndDate = nextEnd

      await doc.save()

      fixed += 1
      console.log(
        `✅ ${employeeId} | AL before=${num(beforeAL?.remaining)} after=${num(afterAL?.remaining)} | asOf=${doc.balancesAsOf}`
      )
    } catch (err) {
      failed += 1
      console.error(`❌ Failed for ${s(doc?.employeeId)}:`, err.message)
    }
  }

  console.log(`\nDone. Fixed=${fixed}, Failed=${failed}`)
  await mongoose.disconnect()
  console.log('👋 MongoDB disconnected')
}

main().catch(async (err) => {
  console.error('❌ Script error:', err)
  try {
    await mongoose.disconnect()
  } catch {}
  process.exit(1)
})