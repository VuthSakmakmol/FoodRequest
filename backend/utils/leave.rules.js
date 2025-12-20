// backend/utils/leave.rules.js
const dayjs = require('dayjs')

let externalIsHoliday = null
try {
  // eslint-disable-next-line global-require
  externalIsHoliday =
    require('./holidays')?.isHoliday || require('../utils/holidays')?.isHoliday
} catch (_) {
  externalIsHoliday = null
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}

function parseYMD(ymd) {
  if (!isValidYMD(ymd)) return null
  const d = dayjs(ymd, 'YYYY-MM-DD', true)
  return d.isValid() ? d : null
}

function envHolidaySet() {
  const raw = String(process.env.HOLIDAYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(raw)
}

function isSunday(ymd) {
  const d = parseYMD(ymd)
  if (!d) return false
  return d.day() === 0
}

function isHolidayYMD(ymd) {
  if (!isValidYMD(ymd)) return false
  if (typeof externalIsHoliday === 'function') {
    try {
      return !!externalIsHoliday(ymd)
    } catch (_) {}
  }
  return envHolidaySet().has(ymd)
}

function isWorkingDay(ymd) {
  if (isSunday(ymd)) return false
  if (isHolidayYMD(ymd)) return false
  return true
}

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

function enumerateWorkingDates(startYMD, endYMD) {
  return enumerateDates(startYMD, endYMD).filter(isWorkingDay)
}

function toYMD(d) {
  return dayjs(d).format('YYYY-MM-DD')
}

function computeJoinYearPeriod(joinDate, now = new Date()) {
  const n = dayjs(now)
  const jd = joinDate ? dayjs(joinDate) : null

  if (!jd || !jd.isValid()) {
    const start = dayjs(`${n.year()}-01-01`)
    const end = dayjs(`${n.year()}-12-31`)
    return { start: start.toDate(), end: end.toDate() }
  }

  let start = dayjs(new Date(n.year(), jd.month(), jd.date()))
  if (start.isAfter(n)) start = start.subtract(1, 'year')
  const end = start.add(1, 'year').subtract(1, 'day')
  return { start: start.toDate(), end: end.toDate() }
}

function serviceYears(joinDate, now = new Date()) {
  const jd = joinDate ? dayjs(joinDate) : null
  if (!jd || !jd.isValid()) return 0

  const n = dayjs(now)
  let years = n.year() - jd.year()
  const annivThisYear = dayjs(new Date(n.year(), jd.month(), jd.date()))
  if (annivThisYear.isAfter(n)) years -= 1
  return years < 0 ? 0 : years
}

function computeALCap(joinDate, base = 18, now = new Date()) {
  const yrs = serviceYears(joinDate, now)
  return base + Math.floor(yrs / 3)
}

/**
 * ✅ Validate + normalize (supports half-day)
 * - startDate must be working day
 * - Half-day: endDate = startDate, totalDays = 0.5, require dayPart AM/PM
 * - MA: fixed 90 days inclusive (end = start + 89), half-day not allowed
 */
function validateAndNormalizeRequest({
  leaveTypeCode,
  startDate,
  endDate,
  isHalfDay = false,
  dayPart = null,
}) {
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

  const half = !!isHalfDay
  const dp = dayPart ? String(dayPart).toUpperCase() : null

  if (code === 'MA') {
    const endFixed = sd.add(89, 'day').format('YYYY-MM-DD')
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: endFixed,
        totalDays: 90,
        isHalfDay: false,
        dayPart: null,
        mode: 'CALENDAR_FIXED_90',
      },
    }
  }

  if (half) {
    if (!dp || !['AM', 'PM'].includes(dp)) {
      return { ok: false, message: 'Half-day requires dayPart AM or PM.' }
    }
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: s,
        totalDays: 0.5,
        isHalfDay: true,
        dayPart: dp,
        mode: 'HALF_DAY',
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
      isHalfDay: false,
      dayPart: null,
      mode: 'WORKING_DAYS',
    },
  }
}

function computeBalances(profile, approvedRequests = [], now = new Date()) {
  const joinDate = profile?.joinDate ? new Date(profile.joinDate) : null
  const contractDate = profile?.contractDate ? new Date(profile.contractDate) : null

  const { start, end } = computeJoinYearPeriod(joinDate, now)
  const periodStartYMD = toYMD(start)
  const periodEndYMD = toYMD(end)

  const approvedInJoinYear = (approvedRequests || []).filter((r) => {
    const s = String(r.startDate || '')
    return s >= periodStartYMD && s <= periodEndYMD
  })

  const sumDays = (code, docs) =>
    (docs || [])
      .filter((r) => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const usedAL = sumDays('AL', approvedRequests)
  const usedSP = sumDays('SP', approvedInJoinYear)
  const usedMC = sumDays('MC', approvedInJoinYear)
  const usedMA = sumDays('MA', approvedInJoinYear)
  const usedUL = sumDays('UL', approvedRequests)

  const accrualStart = contractDate || joinDate
  let alAccrued = 0
  let alCap = computeALCap(joinDate, 18, now)

  if (accrualStart) {
    const a = dayjs(accrualStart)
    const n = dayjs(now)
    let months = (n.year() - a.year()) * 12 + (n.month() - a.month())
    if (n.date() < a.date()) months -= 1
    if (months < 0) months = 0
    if (months > 12) months = 12
    alAccrued = months * 1.5
    if (alAccrued > alCap) alAccrued = alCap
  }

  const alCarry = Number(profile?.alCarry || 0)
  const alRemaining = alAccrued + alCarry - usedAL - usedSP

  const spEnt = 7
  const mcEnt = 90
  const maEnt = 90

  return {
    balances: [
      { leaveTypeCode: 'AL', entitlement: alAccrued, used: usedAL + usedSP, remaining: alRemaining, meta: { cap: alCap, alCarry } },
      { leaveTypeCode: 'SP', entitlement: spEnt, used: usedSP, remaining: spEnt - usedSP, meta: { renewPeriodStart: periodStartYMD, renewPeriodEnd: periodEndYMD } },
      { leaveTypeCode: 'MC', entitlement: mcEnt, used: usedMC, remaining: mcEnt - usedMC, meta: { renewPeriodStart: periodStartYMD, renewPeriodEnd: periodEndYMD } },
      { leaveTypeCode: 'MA', entitlement: maEnt, used: usedMA, remaining: maEnt - usedMA, meta: { fixedDurationDays: 90 } },
      { leaveTypeCode: 'UL', entitlement: 0, used: usedUL, remaining: 0, meta: { unlimited: true } },
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
  enumerateWorkingDates,
  isWorkingDay,
}
