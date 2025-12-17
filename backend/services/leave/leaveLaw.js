// backend/services/leave/leaveLaw.js
const LeaveProfile = require('../../models/leave/LeaveProfile')

/** ---------- constants (LAW) ---------- */
const LAW = Object.freeze({
  AL: Object.freeze({ accrualPerMonth: 1.5 }),
  SP: Object.freeze({ perJoinYear: 7 }),
  MC: Object.freeze({ perJoinYear: 90 }),
  MA: Object.freeze({ fixedCalendarDays: 90 }),
})

/** ---------- date helpers (YYYY-MM-DD, UTC-safe) ---------- */
function assertYMD(ymd, label = 'date') {
  const s = String(ymd || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid ${label}. Expected YYYY-MM-DD, got "${ymd}"`)
  }
  // basic bounds check via Date round-trip
  const dt = ymdToUTCDate(s)
  const back = utcDateToYMD(dt)
  if (back !== s) throw new Error(`Invalid ${label}. Got "${ymd}"`)
  return s
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

function utcDateToYMD(dt) {
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDaysYMD(ymd, days) {
  const base = assertYMD(ymd, 'startDate')
  const dt = ymdToUTCDate(base)
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0))
  return utcDateToYMD(dt)
}

function isBeforeOrEqual(a, b) {
  const A = ymdToUTCDate(assertYMD(a, 'dateA')).getTime()
  const B = ymdToUTCDate(assertYMD(b, 'dateB')).getTime()
  return A <= B
}

/**
 * fullMonthsBetween(joinDate, asOfDate)
 * Counts FULL months based on day-of-month of joinDate.
 * Example: join 2025-01-15 → asOf 2025-02-14 => 0, asOf 2025-02-15 => 1
 */
function fullMonthsBetween(joinYmd, asOfYmd) {
  const join = ymdToUTCDate(assertYMD(joinYmd, 'joinDate'))
  const asOf = ymdToUTCDate(assertYMD(asOfYmd, 'asOfDate'))

  let months =
    (asOf.getUTCFullYear() - join.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - join.getUTCMonth())

  // if asOf day is before join day in month, subtract 1
  if (asOf.getUTCDate() < join.getUTCDate()) months -= 1
  return Math.max(0, months)
}

/**
 * joinYearStart(joinDate, onDate)
 * Returns the start date of the current join-year window (anniversary-based).
 */
function joinYearStart(joinYmd, onYmd) {
  const join = ymdToUTCDate(assertYMD(joinYmd, 'joinDate'))
  const on = ymdToUTCDate(assertYMD(onYmd, 'onDate'))

  let year = on.getUTCFullYear()
  const anniversaryThisYear = new Date(
    Date.UTC(year, join.getUTCMonth(), join.getUTCDate())
  )

  // if onDate before anniversary this year, use previous year anniversary
  if (on.getTime() < anniversaryThisYear.getTime()) year -= 1

  const start = new Date(Date.UTC(year, join.getUTCMonth(), join.getUTCDate()))
  return utcDateToYMD(start)
}

/** ---------- profile guards ---------- */
function ensureProfileShape(profile) {
  if (!profile) return

  // balances
  if (!profile.balances) profile.balances = {}
  if (typeof profile.balances.AL !== 'number') profile.balances.AL = Number(profile.balances.AL || 0)

  // joinYear bucket
  if (!profile.joinYear) {
    profile.joinYear = { anchor: '', spUsed: 0, mcUsed: 0, maUsed: 0 }
  } else {
    if (typeof profile.joinYear.anchor !== 'string') profile.joinYear.anchor = String(profile.joinYear.anchor || '')
    if (typeof profile.joinYear.spUsed !== 'number') profile.joinYear.spUsed = Number(profile.joinYear.spUsed || 0)
    if (typeof profile.joinYear.mcUsed !== 'number') profile.joinYear.mcUsed = Number(profile.joinYear.mcUsed || 0)
    if (typeof profile.joinYear.maUsed !== 'number') profile.joinYear.maUsed = Number(profile.joinYear.maUsed || 0)
  }

  // contracts
  if (!Array.isArray(profile.contracts)) profile.contracts = []
}

/**
 * Ensure profile.joinYear bucket is aligned to current join-year (for SP/MC/MA renewal).
 * If anchor changes => reset used counters.
 */
function ensureJoinYearBuckets(profile, onYmd) {
  ensureProfileShape(profile)
  const start = joinYearStart(profile.joinDate, onYmd)

  if (profile.joinYear.anchor !== start) {
    profile.joinYear = {
      anchor: start,
      spUsed: 0,
      mcUsed: 0,
      maUsed: 0,
    }
  }
}

/**
 * Find current contract subdoc.
 */
function getCurrentContract(profile) {
  ensureProfileShape(profile)
  if (!profile.currentContractId) return null
  return (
    profile.contracts.find(c => String(c._id) === String(profile.currentContractId)) ||
    null
  )
}

/**
 * Sync AL accrual into balances.AL based on joinDate monthly schedule, but only within current contract.
 * - At contract start, we set alCreditedMonths = monthsFromJoin(contractStart)
 * - On sync, credit (monthsNow - alCreditedMonths) * 1.5 days into AL
 */
function syncALAccrual(profile, onYmd) {
  ensureProfileShape(profile)
  const contract = getCurrentContract(profile)
  if (!contract) return

  const monthsNow = fullMonthsBetween(profile.joinDate, onYmd)
  const credited = Number(contract.alCreditedMonths || 0)
  const delta = monthsNow - credited

  if (delta > 0) {
    profile.balances.AL = Number(profile.balances.AL || 0) + delta * LAW.AL.accrualPerMonth
    contract.alCreditedMonths = monthsNow
  }
}

/**
 * Contract renewal:
 * - closes old contract
 * - opens new contract
 * - AL resets to 0, but if AL is negative, carry it forward
 *
 * NOTE: This is an operational action (HR/admin), not policy editing.
 */
function renewContract(profile, { startDate, endDate }) {
  ensureProfileShape(profile)
  const s = assertYMD(startDate, 'startDate')
  const e = assertYMD(endDate, 'endDate')
  if (!isBeforeOrEqual(s, e)) {
    throw new Error('Invalid contract dates: startDate must be <= endDate')
  }

  // close old
  const old = getCurrentContract(profile)
  if (old && !old.closedAt) old.closedAt = new Date()

  // carry only negative AL
  const carry = Math.min(0, Number(profile.balances.AL || 0))
  profile.balances.AL = carry

  // months credited baseline at contract start
  const monthsAtStart = fullMonthsBetween(profile.joinDate, s)

  const newContract = {
    contractNo: (profile.contracts?.length || 0) + 1,
    startDate: s,
    endDate: e,
    alCarryIn: carry,
    alCreditedMonths: monthsAtStart,
  }

  profile.contracts.push(newContract)
  profile.currentContractId = newContract._id
}

/** MA fixed 90 days (calendar) */
function calcMAEndDate(startYmd) {
  const s = assertYMD(startYmd, 'startDate')
  // 90 calendar days: start + 89 = inclusive end, return date = start + 90
  const endDate = addDaysYMD(s, LAW.MA.fixedCalendarDays - 1)
  const returnDate = addDaysYMD(s, LAW.MA.fixedCalendarDays)
  return { endDate, returnDate, totalCalendarDays: LAW.MA.fixedCalendarDays }
}

/**
 * Public API for leave request checks:
 * - loads profile
 * - ensures join-year renewal buckets
 * - syncs AL accrual as-of a given date
 * Returns profile (NOT saved automatically).
 */
async function prepareProfileForDate(employeeId, onYmd) {
  const on = assertYMD(onYmd, 'onDate')

  const profile = await LeaveProfile.findOne({ employeeId })
  if (!profile) return { profile: null, error: 'Leave profile not found.' }

  // Ensure mandatory joinDate exists
  if (!profile.joinDate) {
    return { profile: null, error: 'Leave profile is missing joinDate.' }
  }

  try {
    assertYMD(profile.joinDate, 'joinDate')
  } catch (e) {
    return { profile: null, error: `Invalid joinDate in profile: ${e.message}` }
  }

  ensureProfileShape(profile)
  ensureJoinYearBuckets(profile, on)
  syncALAccrual(profile, on)

  return { profile, error: '' }
}

/** SP/MC available */
function getSPRemaining(profile) {
  ensureProfileShape(profile)
  return Math.max(0, LAW.SP.perJoinYear - Number(profile.joinYear?.spUsed || 0))
}
function getMCRemaining(profile) {
  ensureProfileShape(profile)
  return Math.max(0, LAW.MC.perJoinYear - Number(profile.joinYear?.mcUsed || 0))
}

module.exports = {
  LAW,

  // date helpers
  ymdToUTCDate,
  utcDateToYMD,
  addDaysYMD,
  isBeforeOrEqual,

  // accrual / periods
  fullMonthsBetween,
  joinYearStart,

  // profile ops
  ensureJoinYearBuckets,
  syncALAccrual,
  renewContract,

  // leave-specific helpers
  calcMAEndDate,
  prepareProfileForDate,
  getSPRemaining,
  getMCRemaining,
}
