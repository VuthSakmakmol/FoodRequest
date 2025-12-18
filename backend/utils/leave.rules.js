// backend/utils/leave.rules.js

const dayjs = require('dayjs')

/**
 * Holidays:
 * - Sunday is always non-working
 * - Cambodian National Holidays come from:
 *    A) your existing utils/holidays (if available), OR
 *    B) env HOLIDAYS=YYYY-MM-DD,YYYY-MM-DD
 */
let externalIsHoliday = null
try {
  // If you already have this helper, we’ll reuse it
  // (your replace day controller referenced ../../utils/holidays)
  // eslint-disable-next-line global-require
  externalIsHoliday = require('./holidays')?.isHoliday || require('../utils/holidays')?.isHoliday
} catch (_) {
  externalIsHoliday = null
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}

function toYMD(d) {
  return dayjs(d).format('YYYY-MM-DD')
}

function parseYMD(ymd) {
  if (!isValidYMD(ymd)) return null
  const d = dayjs(ymd, 'YYYY-MM-DD', true)
  return d.isValid() ? d : null
}

function envHolidaySet() {
  const raw = String(process.env.HOLIDAYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return new Set(raw)
}

function isSunday(ymd) {
  const d = parseYMD(ymd)
  if (!d) return false
  return d.day() === 0 // Sunday
}

function isHolidayYMD(ymd) {
  if (!isValidYMD(ymd)) return false

  // If you have an existing holiday engine, use it
  if (typeof externalIsHoliday === 'function') {
    try {
      return !!externalIsHoliday(ymd)
    } catch (_) {
      // fallback to env
    }
  }

  return envHolidaySet().has(ymd)
}

function isWorkingDay(ymd) {
  // Mon–Sat only, exclude holidays
  if (isSunday(ymd)) return false
  if (isHolidayYMD(ymd)) return false
  return true
}

/** enumerate inclusive calendar dates */
function enumerateDates(startYMD, endYMD) {
  const s = parseYMD(startYMD)
  const e = parseYMD(endYMD)
  if (!s || !e) return []
  if (e.isBefore(s)) return []

  const out = []
  let cur = s
  while (cur.isBefore(e) || cur.isSame(e, 'day')) {
    out.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }
  return out
}

/** enumerate only working dates inclusive */
function enumerateWorkingDates(startYMD, endYMD) {
  return enumerateDates(startYMD, endYMD).filter(isWorkingDay)
}

/** join-year period (anniversary based) */
function computeJoinYearPeriod(joinDate, now = new Date()) {
  const n = dayjs(now)
  const jd = joinDate ? dayjs(joinDate) : null

  if (!jd || !jd.isValid()) {
    // fallback calendar year
    const start = dayjs(`${n.year()}-01-01`)
    const end = dayjs(`${n.year()}-12-31`)
    return { start: start.toDate(), end: end.toDate() }
  }

  // Anniversary this year
  let start = dayjs(new Date(n.year(), jd.month(), jd.date()))
  if (start.isAfter(n)) {
    start = start.subtract(1, 'year')
  }
  const end = start.add(1, 'year').subtract(1, 'day')

  return { start: start.toDate(), end: end.toDate() }
}

/** full years of service from joinDate (floor) */
function serviceYears(joinDate, now = new Date()) {
  const jd = joinDate ? dayjs(joinDate) : null
  if (!jd || !jd.isValid()) return 0

  const n = dayjs(now)
  let years = n.year() - jd.year()

  // if anniversary not reached yet this year, minus 1
  const annivThisYear = dayjs(new Date(n.year(), jd.month(), jd.date()))
  if (annivThisYear.isAfter(n)) years -= 1

  return years < 0 ? 0 : years
}

/**
 * AL cap bonus:
 * base 18 + 1 per every 3 years of service from joinDate
 * 3y => 19, 6y => 20, ...
 */
function computeALCap(joinDate, base = 18, now = new Date()) {
  const yrs = serviceYears(joinDate, now)
  const bonus = Math.floor(yrs / 3)
  return base + bonus
}

/**
 * Validate + normalize leave request:
 * - startDate must be a working day (Mon-Sat and not holiday)
 * - totalDays = count working days in range (except MA)
 * - MA: force endDate = start + 89, totalDays = 90 (calendar)
 */
function validateAndNormalizeRequest({ leaveTypeCode, startDate, endDate }) {
  const code = String(leaveTypeCode || '').trim().toUpperCase()
  const s = String(startDate || '').trim()
  const e = String(endDate || '').trim()

  if (!code) return { ok: false, message: 'leaveTypeCode is required' }
  if (!isValidYMD(s)) return { ok: false, message: 'startDate must be YYYY-MM-DD' }
  if (!isValidYMD(e)) return { ok: false, message: 'endDate must be YYYY-MM-DD' }

  if (!isWorkingDay(s)) {
    return { ok: false, message: 'startDate must be a working day (Mon–Sat, not holiday).' }
  }

  const sd = parseYMD(s)
  const ed = parseYMD(e)
  if (!sd || !ed) return { ok: false, message: 'Invalid date format' }
  if (ed.isBefore(sd)) return { ok: false, message: 'endDate must be >= startDate' }

  // MA fixed 90 calendar days inclusive => end = start + 89
  if (code === 'MA') {
    const endFixed = sd.add(89, 'day').format('YYYY-MM-DD')
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: endFixed,
        totalDays: 90,
        mode: 'CALENDAR_FIXED_90',
      },
    }
  }

  const workingDates = enumerateWorkingDates(s, e)
  const totalDays = workingDates.length

  if (!totalDays || totalDays <= 0) {
    return { ok: false, message: 'Invalid date range (no working days).' }
  }

  return {
    ok: true,
    normalized: {
      leaveTypeCode: code,
      startDate: s,
      endDate: e,
      totalDays,
      mode: 'WORKING_DAYS',
    },
  }
}

/**
 * Compute balances snapshot from APPROVED requests only.
 * NOTE: We do NOT trust profile.balances.
 *
 * Key rules:
 * - SP: 7 per join-year
 * - MC: 90 per join-year
 * - MA: 90 per join-year (display), request enforced fixed 90
 * - UL: unlimited
 * - AL: accrues 1.5/month from contractDate (if exists) else joinDate
 *       capped by (18 + floor(serviceYears/3))
 * - SP borrow reduces AL remaining (AL may go negative because of SP)
 * - alCarry is added into AL remaining (negative debt across contract renew)
 */
function computeBalances(profile, approvedRequests = [], now = new Date()) {
  const joinDate = profile?.joinDate ? new Date(profile.joinDate) : null
  const contractDate = profile?.contractDate ? new Date(profile.contractDate) : null

  const { start, end } = computeJoinYearPeriod(joinDate, now)
  const periodStartYMD = toYMD(start)
  const periodEndYMD = toYMD(end)

  // Approved in join-year window (for SP/MC/MA yearly tracking)
  const approvedInJoinYear = (approvedRequests || []).filter(r => {
    const s = String(r.startDate || '')
    return s >= periodStartYMD && s <= periodEndYMD
  })

  const sumDays = (code, docs) =>
    (docs || [])
      .filter(r => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const usedAL = sumDays('AL', approvedRequests)
  const usedSP = sumDays('SP', approvedInJoinYear)
  const usedMC = sumDays('MC', approvedInJoinYear)
  const usedMA = sumDays('MA', approvedInJoinYear)
  const usedUL = sumDays('UL', approvedRequests)

  // AL accrual months from contractDate if exists else joinDate
  const accrualStart = contractDate || joinDate
  let alAccrued = 0
  let alCap = computeALCap(joinDate, 18, now)

  if (accrualStart) {
    const a = dayjs(accrualStart)
    const n = dayjs(now)
    let months =
      (n.year() - a.year()) * 12 + (n.month() - a.month())
    if (n.date() < a.date()) months -= 1
    if (months < 0) months = 0
    if (months > 12) months = 12 // yearly accrual cap window

    alAccrued = months * 1.5
    if (alAccrued > alCap) alAccrued = alCap
  }

  const alCarry = Number(profile?.alCarry || 0) // can be negative
  // SP borrowing reduces AL available
  const alRemaining = alAccrued + alCarry - usedAL - usedSP

  const spEnt = 7
  const spRemaining = spEnt - usedSP

  const mcEnt = 90
  const mcRemaining = mcEnt - usedMC

  const maEnt = 90
  const maRemaining = maEnt - usedMA

  return {
    balances: [
      {
        leaveTypeCode: 'AL',
        name: 'Annual Leave (AL)',
        entitlement: alAccrued,
        used: usedAL + usedSP, // show true impact on AL
        remaining: alRemaining,
        meta: { cap: alCap, accrualPerMonth: 1.5, alCarry },
      },
      {
        leaveTypeCode: 'SP',
        name: 'Special Leave (SP)',
        entitlement: spEnt,
        used: usedSP,
        remaining: spRemaining,
        meta: { renewPeriodStart: periodStartYMD, renewPeriodEnd: periodEndYMD },
      },
      {
        leaveTypeCode: 'MC',
        name: 'Medical / Sick Leave (MC)',
        entitlement: mcEnt,
        used: usedMC,
        remaining: mcRemaining,
        meta: { renewPeriodStart: periodStartYMD, renewPeriodEnd: periodEndYMD },
      },
      {
        leaveTypeCode: 'MA',
        name: 'Maternity Leave (MA)',
        entitlement: maEnt,
        used: usedMA,
        remaining: maRemaining,
        meta: { fixedDurationDays: 90 },
      },
      {
        leaveTypeCode: 'UL',
        name: 'Unpaid Leave (UL)',
        entitlement: 0,
        used: usedUL,
        remaining: 0, // unlimited => not enforced
        meta: { unlimited: true },
      },
    ],
    meta: {
      joinYear: { startDate: periodStartYMD, endDate: periodEndYMD },
      alCap,
      serviceYears: serviceYears(joinDate, now),
      accrualStart: accrualStart ? toYMD(accrualStart) : null,
    },
  }
}

module.exports = {
  validateAndNormalizeRequest,
  computeBalances,
  computeJoinYearPeriod,
  enumerateWorkingDates,
  isWorkingDay,
}
