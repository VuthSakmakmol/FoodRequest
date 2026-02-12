/* eslint-disable no-console */
// backend/utils/leave.rules.js
const dayjs = require('dayjs')

// ✅ Contract helpers (single source of truth)
const {
  isValidYMD: isValidYMD2,
  pickActiveContract,
  endFromStartYMD,
  getActiveCarry,
} = require('./leave/leave.contracts')

let externalIsHoliday = null
try {
  // eslint-disable-next-line global-require
  externalIsHoliday =
    require('./holidays')?.isHoliday || require('../utils/holidays')?.isHoliday
} catch (_) {
  externalIsHoliday = null
}

/* ───────────────── helpers ───────────────── */
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

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function up(v) {
  return String(v ?? '').trim().toUpperCase()
}

/* ───────────────── service years / AL cap ───────────────── */

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

/* ───────────────── contract-year window (ACTIVE CONTRACT) ───────────────── */

/**
 * ✅ Contract-year window MUST follow the active contract
 * With new model, contracts always exist and this will always return active contract range.
 *
 * opts supports: { asOfYMD, contractId, contractNo }
 */
function computeContractYearPeriod(profile, now = new Date(), opts = {}) {
  const asOfYMD =
    opts?.asOfYMD && isValidYMD(opts.asOfYMD) ? String(opts.asOfYMD).trim() : null

  const active = pickActiveContract(profile, {
    contractId: opts?.contractId ?? null,
    contractNo: opts?.contractNo ?? null,
    asOf: asOfYMD,
    contractDate: isValidYMD(profile?.contractDate)
      ? String(profile.contractDate).trim()
      : null,
  })

  if (active && isValidYMD2(active.startDate)) {
    const startYMD = String(active.startDate).trim()
    const endYMD = isValidYMD2(active.endDate)
      ? String(active.endDate).trim()
      : endFromStartYMD(startYMD)
    return { startYMD, endYMD, activeContract: active }
  }

  // fallback (should not happen for new clean data)
  const n = dayjs(now)
  const s = dayjs(`${n.year()}-01-01`, 'YYYY-MM-DD', true)
  const e = dayjs(`${n.year()}-12-31`, 'YYYY-MM-DD', true)
  return {
    startYMD: s.format('YYYY-MM-DD'),
    endYMD: e.format('YYYY-MM-DD'),
    activeContract: null,
  }
}

/* ───────────────── request validator ───────────────── */

function validateAndNormalizeRequest({
  leaveTypeCode,
  startDate,
  endDate,
  isHalfDay = false, // legacy single-day half
  dayPart = null, // legacy single-day half
  startHalf = null, // NEW (AM/PM)
  endHalf = null, // NEW (AM/PM)
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

  if (!isWorkingDay(s)) {
    return { ok: false, message: 'startDate must be a working day (Mon–Sat, not holiday).' }
  }
  if (!isWorkingDay(e)) {
    return { ok: false, message: 'endDate must be a working day (Mon–Sat, not holiday).' }
  }

  // MA fixed 90 calendar days inclusive
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
        isHalfDay: false,
        dayPart: null,
        startHalf: null,
        endHalf: null,
        mode: 'CALENDAR_FIXED_90',
      },
    }
  }

  const isSingleDay = s === e

  // legacy half-day (single day)
  const legacyHalf = !!isHalfDay
  const dp = legacyHalf ? normalizeHalf(dayPart) : null
  if (legacyHalf) {
    if (!dp) return { ok: false, message: 'Half-day requires dayPart AM or PM.' }
    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: s,
        endDate: s,
        totalDays: 0.5,
        isHalfDay: true,
        dayPart: dp,
        startHalf: dp,
        endHalf: null,
        mode: 'HALF_DAY_SINGLE',
      },
    }
  }

  // new half edges
  let sh = normalizeHalf(startHalf)
  let eh = normalizeHalf(endHalf)

  if (isSingleDay) {
    // if only endHalf provided for single day, treat it as startHalf
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
          isHalfDay: true,
          dayPart: sh,
          startHalf: sh,
          endHalf: null,
          mode: 'HALF_DAY_SINGLE',
        },
      }
    }

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

  // multi-day working days
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
      isHalfDay: false,
      dayPart: null,
      startHalf: sh,
      endHalf: eh,
      mode: 'WORKING_DAYS_HALF_EDGES',
    },
  }
}

/* ───────────────── balances (APPLY ACTIVE CONTRACT CARRY) ───────────────── */

/**
 * ✅ Apply carry:
 * remaining = (entitlement - used) + carry
 * used display includes negative carry: used += max(0, -carry)
 */
function applyCarry(ent, used, carry) {
  const c = num(carry)
  const baseRemaining = num(ent) - num(used)
  const remaining = baseRemaining + c
  const usedDisplay = num(used) + (c < 0 ? Math.abs(c) : 0)
  return { remaining, usedDisplay }
}

/**
 * ✅ Compute balances for CURRENT ACTIVE CONTRACT-YEAR.
 * Rules:
 * - SP max 7 per contract-year
 * - SP ALWAYS borrows from AL (AL_USED_TOTAL = AL + SP)
 * - Carry is read from ACTIVE CONTRACT carry (contracts[].carry)
 *
 * IMPORTANT:
 * We count request usage if startDate is within the contract-year window.
 */
function computeBalances(profile, approvedRequests = [], now = new Date(), opts = {}) {
  const asOfYMD = opts?.asOfYMD && isValidYMD(opts.asOfYMD) ? String(opts.asOfYMD).trim() : toYMD(now)

  const { startYMD, endYMD, activeContract } = computeContractYearPeriod(profile, now, {
    asOfYMD,
    contractId: opts?.contractId ?? null,
    contractNo: opts?.contractNo ?? null,
  })

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
  const UL_ENT = 0 // unlimited

  const carryRaw = getActiveCarry(profile, {
    contractId: opts?.contractId ?? null,
    contractNo: opts?.contractNo ?? null,
    asOf: asOfYMD,
    contractDate: profile?.contractDate,
  })

  // ✅ SP and AL are the same pool (SP borrows from AL)
  // Any SP carry must be treated as AL carry.
  const carry = {
    ...carryRaw,
    AL: num(carryRaw.AL) + num(carryRaw.SP),
    SP: 0,
  }


  // ✅ base request usage (SP always borrows from AL)
  const AL_USED_TOTAL = usedAL + usedSP

  // ✅ AL with carry
  const alCarryApplied = applyCarry(AL_ENT, AL_USED_TOTAL, carry.AL)
  const alRemaining = alCarryApplied.remaining
  const alUsedDisplay = alCarryApplied.usedDisplay

  // ✅ SP remaining: (7 - usedSP) capped by max(0, AL remaining)
  const spEntRemaining = Number(SP_ENT - usedSP)
  const spRemaining = Math.max(0, Math.min(spEntRemaining, Math.max(0, alRemaining)))

  // display SP used (carry normally 0, but supported)
  const spCarryApplied = applyCarry(SP_ENT, usedSP, carry.SP)

  const mcCarryApplied = applyCarry(MC_ENT, usedMC, carry.MC)
  const maCarryApplied = applyCarry(MA_ENT, usedMA, carry.MA)

  // UL is unlimited -> remaining is always 0, but we still allow carry to affect “used display” if you store UL carry negative
  const ulCarryApplied = applyCarry(UL_ENT, usedUL, carry.UL)

  return {
    balances: [
      {
        leaveTypeCode: 'AL',
        yearlyEntitlement: AL_ENT,
        used: alUsedDisplay,
        remaining: alRemaining,
      },
      {
        leaveTypeCode: 'SP',
        yearlyEntitlement: SP_ENT,
        used: spCarryApplied.usedDisplay,
        remaining: spRemaining,
      },
      {
        leaveTypeCode: 'MC',
        yearlyEntitlement: MC_ENT,
        used: mcCarryApplied.usedDisplay,
        remaining: mcCarryApplied.remaining,
      },
      {
        leaveTypeCode: 'MA',
        yearlyEntitlement: MA_ENT,
        used: maCarryApplied.usedDisplay,
        remaining: maCarryApplied.remaining,
      },
      {
        leaveTypeCode: 'UL',
        yearlyEntitlement: 0,
        used: ulCarryApplied.usedDisplay,
        remaining: 0, // ✅ UL is unlimited
      },
    ],
    meta: {
      asOfYMD,
      contractYear: { startDate: startYMD, endDate: endYMD },
      activeContract: activeContract
        ? {
            contractNo: activeContract.contractNo,
            startDate: activeContract.startDate,
            endDate: activeContract.endDate,
          }
        : null,
      contractDate: isValidYMD(profile?.contractDate) ? String(profile.contractDate) : null,
      joinDate: isValidYMD(profile?.joinDate) ? String(profile.joinDate) : null,
      serviceYears: serviceYearsFromJoin(profile?.joinDate, now),
      carry, // helpful for debugging/UI
    },
  }
}

module.exports = {
  validateAndNormalizeRequest,
  computeBalances,
  computeContractYearPeriod,
  enumerateWorkingDates,
  isWorkingDay,
  toYMD,
}
