/* eslint-disable no-console */
// backend/services/leave.recalculate.service.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const { computeBalances } = require('../../utils/leave.rules')

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
function todayYMD(date = new Date()) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function recalculateOneProfile(profileDocOrEmployeeId, options = {}) {
  const {
    asOfDate = new Date(),
    save = true,
    log = false,
  } = options

  let doc = profileDocOrEmployeeId

  if (typeof profileDocOrEmployeeId === 'string') {
    doc = await LeaveProfile.findOne({ employeeId: s(profileDocOrEmployeeId) })
  }

  if (!doc) return null

  const employeeId = s(doc.employeeId)
  const latest = latestContract(doc.contracts || [])
  const asOfYMD = todayYMD(asOfDate)

  const approved = await LeaveRequest.find({
    employeeId,
    status: 'APPROVED',
  })
    .sort({ startDate: 1 })
    .lean()

  const plain = doc.toObject ? doc.toObject() : { ...doc }
  plain.balances = []
  plain.balancesAsOf = ''

  const snap = computeBalances(plain, approved, asOfDate, {
    asOfYMD,
    contractNo: latest?.contractNo || undefined,
  })

  const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
  const nextAsOf = s(snap?.meta?.asOfYMD || asOfYMD)
  const nextEnd =
    s(snap?.meta?.contractYear?.endDate || '') ||
    (isValidYMD(latest?.startDate) ? contractEndFromStart(latest.startDate) : '')

  doc.balances = nextBalances
  doc.balancesAsOf = nextAsOf
  if (nextEnd) doc.contractEndDate = nextEnd

  if (save && typeof doc.save === 'function') {
    await doc.save()
  }

  if (log) {
    const al = (nextBalances || []).find(
      (b) => s(b?.leaveTypeCode).toUpperCase() === 'AL'
    )
    console.log(
      `✅ recalculated ${employeeId} | AL used=${num(al?.used)} remain=${num(al?.remaining)} | asOf=${nextAsOf}`
    )
  }

  return doc
}

async function recalculateAllProfiles(options = {}) {
  const {
    filter = {},
    asOfDate = new Date(),
    log = true,
  } = options

  const profiles = await LeaveProfile.find(filter)
  let fixed = 0
  let failed = 0

  for (const doc of profiles) {
    try {
      await recalculateOneProfile(doc, { asOfDate, save: true, log: false })
      fixed += 1
      if (log) console.log(`✅ recalculated ${s(doc.employeeId)}`)
    } catch (err) {
      failed += 1
      console.error(`❌ failed ${s(doc?.employeeId)}: ${err.message}`)
    }
  }

  if (log) {
    console.log(`Done. Fixed=${fixed}, Failed=${failed}`)
  }

  return { fixed, failed, total: profiles.length }
}

module.exports = {
  recalculateOneProfile,
  recalculateAllProfiles,
}