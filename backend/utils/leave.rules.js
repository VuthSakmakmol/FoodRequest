/* eslint-disable no-console */
// backend/utils/leave.rules.js
const dayjs = require('dayjs')

// ✅ Use contract carry as the single source of truth
// File you showed: backend/utils/leave/leave.contracts.js
const { getActiveCarry } = require('./leave/leave.contracts')

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
 * ✅ AL cap increases by +1 for every 3 years of service
 * Base = 18
 */
function computeALByServiceYears(joinYMD, asOfDate = new Date()) {
  const yrs = serviceYearsFromJoin(joinYMD, asOfDate)

  // bump starts at year 4, then every +3 years
  const bumps = Math.floor(Math.max(0, yrs - 1) / 3)

  return 18 + bumps
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
 * ✅ Validate + normalize leave request (supports half edges)
 * Rules:
 * - startDate must be working day (Mon–Sat, not holiday)
 * - endDate must be working day (Mon–Sat, not holiday)
 * - MA: fixed 90 calendar days inclusive (end = start + 89), half not allowed
 *
 * Half-day support:
 * A) Single-day half (legacy):
 *   - isHalfDay=true, dayPart=AM/PM
 *   - endDate=startDate, totalDays=0.5
 *
 * B) Multi-day half edges (new):
 *   - startHalf: null|AM|PM (optional)
 *   - endHalf: null|AM|PM (optional)
 *   - totalDays = workingDaysCount - 0.5(startHalf?) - 0.5(endHalf?)
 */
function validateAndNormalizeRequest({
  leaveTypeCode,
  startDate,
  endDate,
  isHalfDay = false,   // legacy
  dayPart = null,      // legacy
  startHalf = null,    // NEW
  endHalf = null,      // NEW
}) {
  const code = String(leaveTypeCode || '').trim().toUpperCase()
  const s = String(startDate || '').trim()
  const e = String(endDate || '').trim()

  const normalizeHalf = (v) => {
    const x = v ? String(v).trim().toUpperCase() : ''
    if (!x) return null
    if (x === 'AM' || x === 'MORNING') return 'AM'
    if (x === 'PM' || x === 'AFTERNOON') return 'PM'
    return null
  }

  if (!code) return { ok: false, message: 'leaveTypeCode is required' }
  if (!isValidYMD(s)) return { ok: false, message: 'startDate must be YYYY-MM-DD' }
  if (!isValidYMD(e)) return { ok: false, message: 'endDate must be YYYY-MM-DD' }

  const sd = parseYMD(s)
  const ed = parseYMD(e)
  if (!sd || !ed) return { ok: false, message: 'Invalid date format' }
  if (ed.isBefore(sd)) return { ok: false, message: 'endDate must be >= startDate' }

  // ✅ policy: both start & end must be working days
  if (!isWorkingDay(s)) {
    return { ok: false, message: 'startDate must be a working day (Mon–Sat, not holiday).' }
  }
  if (!isWorkingDay(e)) {
    return { ok: false, message: 'endDate must be a working day (Mon–Sat, not holiday).' }
  }

  // ✅ MA fixed 90 calendar days inclusive, no half
  if (code === 'MA') {
    if (isHalfDay || startHalf || endHalf) {
      return { ok: false, message: 'MA does not support half-day.' }
    }
    const endFixed = sd.add(89, 'day').format('YYYY-MM-DD')
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: endFixed,
        totalDays: 90,
        // legacy
        isHalfDay: false,
        dayPart: null,
        // new
        startHalf: null,
        endHalf: null,
        mode: 'CALENDAR_FIXED_90',
      },
    }
  }

  const isSingleDay = s === e

  // ✅ Legacy single-day half
  const legacyHalf = !!isHalfDay
  const dp = legacyHalf ? normalizeHalf(dayPart) : null

  if (legacyHalf) {
    if (!dp) return { ok: false, message: 'Half-day requires dayPart AM or PM.' }

    // single-day only
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: s,
        totalDays: 0.5,
        // legacy
        isHalfDay: true,
        dayPart: dp,
        // new mapping (helps consistency)
        startHalf: dp,
        endHalf: null,
        mode: 'HALF_DAY_SINGLE',
      },
    }
  }

  // ✅ New half edges (multi-day or single-day full)
  let sh = normalizeHalf(startHalf)
  let eh = normalizeHalf(endHalf)

  // For single-day requests: allow only ONE half selector (use startHalf)
  if (isSingleDay) {
    if (eh && !sh) sh = eh
    eh = null

    if (sh) {
      return {
        ok: true,
        normalized: {
          leaveTypeCode: code,
          startDate: s,
          endDate: s,
          totalDays: 0.5,
          // legacy fields kept consistent
          isHalfDay: true,
          dayPart: sh,
          // new
          startHalf: sh,
          endHalf: null,
          mode: 'HALF_DAY_SINGLE',
        },
      }
    }

    // single-day full
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: s,
        totalDays: 1,
        isHalfDay: false,
        dayPart: null,
        startHalf: null,
        endHalf: null,
        mode: 'WORKING_DAYS',
      },
    }
  }

  // ✅ Multi-day working days with optional half edges
  const workingDates = enumerateWorkingDates(s, e)
  const workingCount = workingDates.length
  if (!workingCount || workingCount <= 0) {
    return { ok: false, message: 'Invalid date range (no working days).' }
  }

  let totalDays = workingCount
  if (sh && isWorkingDay(s)) totalDays -= 0.5
  if (eh && isWorkingDay(e)) totalDays -= 0.5

  totalDays = Math.max(0.5, Math.round(totalDays * 2) / 2)

  return {
    ok: true,
    normalized: {
      leaveTypeCode: code,
      startDate: s,
      endDate: e,
      totalDays,
      // legacy fields: only for single-day half; multi-day uses new fields
      isHalfDay: false,
      dayPart: null,
      // new
      startHalf: sh,
      endHalf: eh,
      mode: 'WORKING_DAYS_HALF_EDGES',
    },
  }
}

/**
 * ✅ Compute balances for current contract-year.
 *
 * RULES:
 * - SP is allowed (max 7 per contract-year)
 * - Every SP day ALWAYS deducts from AL remaining (AL_USED_TOTAL = AL + SP)
 *
 * ✅ DISPLAY RULE (your request):
 * - If carry is negative => show it as extra "used"
 *   Example: UL carry -2 => UL used becomes 2
 *
 * IMPORTANT:
 * We count request usage if startDate is within the contract-year window.
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

  // ✅ base request usage (SP always borrows from AL)
  const AL_USED_TOTAL = usedAL + usedSP
  const alRemaining = Number(AL_ENT - AL_USED_TOTAL)

  // ✅ base SP remaining capped by base AL remaining
  const spEntRemaining = Number(SP_ENT - usedSP)
  const spRemaining = Math.max(0, Math.min(spEntRemaining, Math.max(0, alRemaining)))

  return {
    balances: [
      { leaveTypeCode: 'AL', yearlyEntitlement: AL_ENT, used: AL_USED_TOTAL, remaining: alRemaining },
      { leaveTypeCode: 'SP', yearlyEntitlement: SP_ENT, used: usedSP, remaining: spRemaining },
      { leaveTypeCode: 'MC', yearlyEntitlement: MC_ENT, used: usedMC, remaining: MC_ENT - usedMC },
      { leaveTypeCode: 'MA', yearlyEntitlement: MA_ENT, used: usedMA, remaining: MA_ENT - usedMA },
      { leaveTypeCode: 'UL', yearlyEntitlement: 0, used: usedUL, remaining: 0 },
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
  toYMD,
}
