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
function up(v) {
  return s(v).toUpperCase()
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

function normalizeCarryObj(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    AL: num(src.AL),
    SP: num(src.SP),
    MC: num(src.MC),
    MA: num(src.MA),
    UL: num(src.UL),
  }
}

function latestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null

  const withStart = arr.filter((c) => isValidYMD(c?.startDate))
  if (withStart.length) {
    return withStart.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  }

  return arr.slice().sort((a, b) => num(b.contractNo) - num(a.contractNo))[0]
}

function setPointersToLatest(profileDoc) {
  const latest = latestContract(profileDoc.contracts || [])
  if (!latest || !isValidYMD(latest.startDate)) return
  profileDoc.contractDate = s(latest.startDate)
  profileDoc.contractEndDate = isValidYMD(latest.endDate)
    ? s(latest.endDate)
    : contractEndFromStart(latest.startDate)
}

function applyCarryToBalancesForDisplay(balances = [], carry = {}) {
  const carryObj = normalizeCarryObj(carry)
  const byCode = new Map(Object.entries(carryObj).map(([k, v]) => [up(k), num(v)]))

  return (Array.isArray(balances) ? balances : []).map((row) => {
    const code = up(row?.leaveTypeCode)
    const yearlyEntitlement = num(row?.yearlyEntitlement)
    const used = num(row?.used)
    const remaining = num(row?.remaining)

    const carryValue = num(byCode.get(code) ?? 0)
    const extraUsedFromCarry = carryValue < 0 ? Math.abs(carryValue) : 0
    const nextRemaining = remaining + carryValue

    return {
      ...row,
      yearlyEntitlement,
      used: used + extraUsedFromCarry,
      remaining: code === 'UL' ? Math.max(0, nextRemaining) : nextRemaining,
    }
  })
}

async function recalcOne(profileDoc) {
  const employeeId = s(profileDoc.employeeId)

  setPointersToLatest(profileDoc)

  const approved = await LeaveRequest.find({
    employeeId,
    status: 'APPROVED',
  })
    .sort({ startDate: 1 })
    .lean()

  const latest = latestContract(profileDoc.contracts || [])
  const asOfDate = isValidYMD(latest?.startDate)
    ? ymdToUTCDate(latest.startDate)
    : new Date()

  const profilePlain = profileDoc.toObject ? profileDoc.toObject() : profileDoc

  const snap = computeBalances(profilePlain, approved, asOfDate, {
    asOfYMD: isValidYMD(latest?.startDate) ? s(latest.startDate) : undefined,
    contractNo: latest?.contractNo || undefined,
  })

  let nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
  const nextAsOf = s(snap?.meta?.asOfYMD || '')
  const nextEnd = s(snap?.meta?.contractYear?.endDate || profileDoc.contractEndDate || '')

  const activeCarry = normalizeCarryObj(latest?.carry || {})
  nextBalances = applyCarryToBalancesForDisplay(nextBalances, activeCarry)

  profileDoc.balances = nextBalances
  if (nextAsOf) profileDoc.balancesAsOf = nextAsOf
  if (nextEnd) profileDoc.contractEndDate = nextEnd

  await profileDoc.save()

  const al = (nextBalances || []).find((x) => up(x.leaveTypeCode) === 'AL')
  return {
    employeeId,
    joinDate: s(profileDoc.joinDate),
    contractDate: s(profileDoc.contractDate),
    alEntitlement: num(al?.yearlyEntitlement),
    alUsed: num(al?.used),
    alRemaining: num(al?.remaining),
  }
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(MONGO_URI)
  console.log('✅ MongoDB connected')

  const profiles = await LeaveProfile.find({}).sort({ employeeId: 1 })
  console.log(`Found ${profiles.length} leave profiles`)

  let ok = 0
  let failed = 0

  for (const p of profiles) {
    try {
      const result = await recalcOne(p)
      ok += 1
      console.log(
        `[OK] ${result.employeeId} | join=${result.joinDate} | contract=${result.contractDate} | AL=${result.alEntitlement} | used=${result.alUsed} | remain=${result.alRemaining}`
      )
    } catch (err) {
      failed += 1
      console.error(`[FAILED] ${p.employeeId}:`, err.message)
    }
  }

  console.log(`\nDone. Success=${ok}, Failed=${failed}`)
  await mongoose.disconnect()
  console.log('✅ MongoDB disconnected')
}

main().catch(async (err) => {
  console.error('Fatal:', err)
  try {
    await mongoose.disconnect()
  } catch {}
  process.exit(1)
})