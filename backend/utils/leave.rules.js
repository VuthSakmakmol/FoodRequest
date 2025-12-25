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
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
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

/**
 * ✅ Service years: full years from joinDate to asOfDate.
 * Example:
 * - join 2022-12-25, asOf 2025-12-24 => 2 years
 * - join 2022-12-25, asOf 2025-12-25 => 3 years
 */
function serviceYearsFromJoin(joinYMD, asOfDate = new Date()) {
  const jd = joinYMD ? dayjs(joinYMD, 'YYYY-MM-DD', true) : null
  if (!jd || !jd.isValid()) return 0

  const n = dayjs(asOfDate)
  let years = n.year() - jd.year()

  const annivThisYear = dayjs(new Date(n.year(), jd.month(), jd.date()))
  if (annivThisYear.isAfter(n)) years -= 1

  return years < 0 ? 0 : years
}

/**
 * ✅ NEW AL RULE:
 * - Year 1–3 => 18
 * - Year 4   => 19
 * - Year 5   => 20
 * - ...
 */
function computeALByServiceYears(joinYMD, asOfDate = new Date()) {
  const yrs = serviceYearsFromJoin(joinYMD, asOfDate)
  return 18 + Math.max(0, yrs - 3)
}

/**
 * ✅ Contract-year window:
 * start = contractDate if valid else joinDate
 * end = start + 1 year - 1 day
 */
function computeContractYearPeriod(profile, now = new Date()) {
  const join = String(profile?.joinDate || '').trim()
  const contract = String(profile?.contractDate || '').trim()

  const startYMD =
    isValidYMD(contract) ? contract : isValidYMD(join) ? join : ''

  if (!startYMD) {
    // fallback to calendar year if missing
    const n = dayjs(now)
    const s = dayjs(`${n.year()}-01-01`, 'YYYY-MM-DD', true)
    const e = dayjs(`${n.year()}-12-31`, 'YYYY-MM-DD', true)
    return { startYMD: s.format('YYYY-MM-DD'), endYMD: e.format('YYYY-MM-DD') }
  }

  const s = dayjs(startYMD, 'YYYY-MM-DD', true)
  const end = s.add(1, 'year').subtract(1, 'day')
  return { startYMD: s.format('YYYY-MM-DD'), endYMD: end.format('YYYY-MM-DD') }
}

/**
 * ✅ Validate + normalize leave request (supports half-day)
 * - startDate must be working day (Mon–Sat, not holiday)
 * - Half-day: endDate = startDate, totalDays = 0.5, require dayPart AM/PM
 * - MA: fixed 90 calendar days inclusive (end = start + 89), half-day not allowed
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

/**
 * ✅ Compute balances for current contract-year.
 * - AL is fixed entitlement per service year rule (18, then +1 after 3 years each year)
 * - SP max 7 per contract-year
 * - SP borrows from AL -> AL remaining can go negative
 *
 * IMPORTANT:
 * We count request usage if startDate is within the contract-year window (same as your prior style).
 */
function computeBalances(profile, approvedRequests = [], now = new Date()) {
  const { startYMD, endYMD } = computeContractYearPeriod(profile, now)

  const approvedInPeriod = (approvedRequests || []).filter((r) => {
    const s = String(r.startDate || '')
    return s >= startYMD && s <= endYMD
  })

  const sumDays = (code, docs) =>
    (docs || [])
      .filter((r) => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const usedAL = sumDays('AL', approvedInPeriod)
  const usedSP = sumDays('SP', approvedInPeriod)
  const usedMC = sumDays('MC', approvedInPeriod)
  const usedMA = sumDays('MA', approvedInPeriod)
  const usedUL = sumDays('UL', approvedInPeriod)

  const AL_ENT = computeALByServiceYears(profile?.joinDate, now)
  const SP_ENT = 7
  const MC_ENT = 90
  const MA_ENT = 90

  // ✅ SP borrows from AL
  const AL_USED_TOTAL = usedAL + usedSP
  const alRemaining = Number(AL_ENT - AL_USED_TOTAL) // can go negative

  return {
    balances: [
      {
        leaveTypeCode: 'AL',
        yearlyEntitlement: AL_ENT,
        used: AL_USED_TOTAL, // ✅ includes SP usage
        remaining: alRemaining, // ✅ can be negative
      },
      {
        leaveTypeCode: 'SP',
        yearlyEntitlement: SP_ENT,
        used: usedSP,
        remaining: SP_ENT - usedSP,
      },
      {
        leaveTypeCode: 'MC',
        yearlyEntitlement: MC_ENT,
        used: usedMC,
        remaining: MC_ENT - usedMC,
      },
      {
        leaveTypeCode: 'MA',
        yearlyEntitlement: MA_ENT,
        used: usedMA,
        remaining: MA_ENT - usedMA,
      },
      {
        leaveTypeCode: 'UL',
        yearlyEntitlement: 0,
        used: usedUL,
        remaining: 0,
      },
    ],
    meta: {
      contractYear: { startDate: startYMD, endDate: endYMD },
      contractDate: isValidYMD(profile?.contractDate) ? String(profile.contractDate) : null,
      joinDate: isValidYMD(profile?.joinDate) ? String(profile.joinDate) : null,
      serviceYears: serviceYearsFromJoin(profile?.joinDate, now),
    },
  }
}

module.exports = {
  validateAndNormalizeRequest,
  computeBalances,
  enumerateWorkingDates,
  isWorkingDay,
}
