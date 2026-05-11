// backend/utils/leave.rules.js
/* eslint-disable no-console */

const dayjs = require('dayjs')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(customParseFormat)

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
function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function isValidYMD(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(value))
}

function parseYMD(ymd) {
  if (!isValidYMD(ymd)) return null

  const d = dayjs(s(ymd), 'YYYY-MM-DD', true)
  return d.isValid() ? d : null
}

function toDateFromYMD(ymd) {
  const d = parseYMD(ymd)
  return d ? d.toDate() : null
}

function toYMD(date = new Date()) {
  const d = dayjs(date)
  return d.isValid() ? d.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
}

function envHolidaySet() {
  const raw = String(process.env.HOLIDAYS || '')
    .split(',')
    .map((x) => s(x))
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
      return !!externalIsHoliday(s(ymd))
    } catch (_) {}
  }

  return envHolidaySet().has(s(ymd))
}

function isWorkingDay(ymd) {
  if (!isValidYMD(ymd)) return false
  if (isSunday(ymd)) return false
  if (isHolidayYMD(ymd)) return false

  return true
}

function enumerateDates(startYMD, endYMD) {
  const start = parseYMD(startYMD)
  const end = parseYMD(endYMD)

  if (!start || !end) return []
  if (end.isBefore(start, 'day')) return []

  const out = []
  let cur = start

  while (cur.isBefore(end, 'day') || cur.isSame(end, 'day')) {
    out.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }

  return out
}

function enumerateWorkingDates(startYMD, endYMD) {
  return enumerateDates(startYMD, endYMD).filter(isWorkingDay)
}

/* ───────────────── service years / AL entitlement ───────────────── */

function serviceYearsFromJoin(joinYMD, asOfDate = new Date()) {
  const join = parseYMD(joinYMD)
  if (!join) return 0

  const asOf = dayjs(asOfDate)
  if (!asOf.isValid()) return 0

  let years = asOf.year() - join.year()

  const anniversaryThisYear = join.year(asOf.year())
  if (anniversaryThisYear.isAfter(asOf, 'day')) {
    years -= 1
  }

  return Math.max(0, years)
}

/**
 * AL rule:
 * 0-2 years  => 18
 * 3-5 years  => 19
 * 6-8 years  => 20
 * 9-11 years => 21
 */
function computeALByServiceYears(joinYMD, asOfDate = new Date()) {
  const years = serviceYearsFromJoin(joinYMD, asOfDate)
  const bumps = Math.floor(years / 3)

  return 18 + bumps
}

/* ───────────────── contract-year window ───────────────── */

function computeContractYearPeriod(profile, now = new Date(), opts = {}) {
  const asOfYMD =
    opts?.asOfYMD && isValidYMD(opts.asOfYMD)
      ? s(opts.asOfYMD)
      : toYMD(now)

  const active = pickActiveContract(profile, {
    contractId: opts?.contractId ?? null,
    contractNo: opts?.contractNo ?? null,
    asOf: asOfYMD,
    contractDate: isValidYMD(profile?.contractDate) ? s(profile.contractDate) : null,
  })

  if (active && isValidYMD2(active.startDate)) {
    const startYMD = s(active.startDate)
    const endYMD = isValidYMD2(active.endDate)
      ? s(active.endDate)
      : endFromStartYMD(startYMD)

    return {
      startYMD,
      endYMD,
      activeContract: active,
    }
  }

  const n = dayjs(now)
  const year = n.isValid() ? n.year() : dayjs().year()

  return {
    startYMD: `${year}-01-01`,
    endYMD: `${year}-12-31`,
    activeContract: null,
  }
}

/* ───────────────── request validator ───────────────── */

function normalizeHalf(value) {
  const raw = up(value)

  if (!raw) return null
  if (raw === 'AM' || raw === 'MORNING') return 'AM'
  if (raw === 'PM' || raw === 'AFTERNOON') return 'PM'

  return null
}

function validateAndNormalizeRequest({
  leaveTypeCode,
  startDate,
  endDate,
  isHalfDay = false,
  dayPart = null,
  startHalf = null,
  endHalf = null,
}) {
  const code = up(leaveTypeCode)
  const start = s(startDate)
  const end = s(endDate)

  if (!code) {
    return { ok: false, message: 'leaveTypeCode is required' }
  }

  if (!isValidYMD(start)) {
    return { ok: false, message: 'startDate must be YYYY-MM-DD' }
  }

  if (!isValidYMD(end)) {
    return { ok: false, message: 'endDate must be YYYY-MM-DD' }
  }

  const startDay = parseYMD(start)
  const endDay = parseYMD(end)

  if (!startDay || !endDay) {
    return { ok: false, message: 'Invalid date format' }
  }

  if (endDay.isBefore(startDay, 'day')) {
    return { ok: false, message: 'endDate must be >= startDate' }
  }

  if (!isWorkingDay(start)) {
    return {
      ok: false,
      message: 'startDate must be a working day (Mon–Sat, not holiday).',
    }
  }

  if (!isWorkingDay(end)) {
    return {
      ok: false,
      message: 'endDate must be a working day (Mon–Sat, not holiday).',
    }
  }

  if (code === 'MA') {
    if (isHalfDay || startHalf || endHalf) {
      return { ok: false, message: 'MA does not support half-day.' }
    }

    const fixedEnd = startDay.add(89, 'day').format('YYYY-MM-DD')

    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: start,
        endDate: fixedEnd,
        totalDays: 90,
        isHalfDay: false,
        dayPart: null,
        startHalf: null,
        endHalf: null,
        mode: 'CALENDAR_FIXED_90',
      },
    }
  }

  const isSingleDay = start === end
  const legacyHalf = !!isHalfDay
  const legacyDayPart = legacyHalf ? normalizeHalf(dayPart) : null

  if (legacyHalf) {
    if (!legacyDayPart) {
      return { ok: false, message: 'Half-day requires dayPart AM or PM.' }
    }

    return {
      ok: true,
      normalized: {
        leaveTypeCode: code,
        startDate: start,
        endDate: start,
        totalDays: 0.5,
        isHalfDay: true,
        dayPart: legacyDayPart,
        startHalf: legacyDayPart,
        endHalf: null,
        mode: 'HALF_DAY_SINGLE',
      },
    }
  }

  let sh = normalizeHalf(startHalf)
  let eh = normalizeHalf(endHalf)

  if (isSingleDay) {
    if (eh && !sh) sh = eh
    eh = null

    if (sh) {
      return {
        ok: true,
        normalized: {
          leaveTypeCode: code,
          startDate: start,
          endDate: start,
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
        startDate: start,
        endDate: start,
        totalDays: 1,
        isHalfDay: false,
        dayPart: null,
        startHalf: null,
        endHalf: null,
        mode: 'WORKING_DAYS',
      },
    }
  }

  const workingDates = enumerateWorkingDates(start, end)
  const workingCount = workingDates.length

  if (workingCount <= 0) {
    return { ok: false, message: 'Invalid date range (no working days).' }
  }

  let totalDays = workingCount

  if (sh && isWorkingDay(start)) totalDays -= 0.5
  if (eh && isWorkingDay(end)) totalDays -= 0.5

  totalDays = Math.max(0.5, Math.round(totalDays * 2) / 2)

  return {
    ok: true,
    normalized: {
      leaveTypeCode: code,
      startDate: start,
      endDate: end,
      totalDays,
      isHalfDay: false,
      dayPart: null,
      startHalf: sh,
      endHalf: eh,
      mode: 'WORKING_DAYS_HALF_EDGES',
    },
  }
}

/* ───────────────── balance calculator ───────────────── */

function requestIsApprovedInPeriod(request, startYMD, endYMD) {
  const status = up(request?.status || 'APPROVED')
  if (status && status !== 'APPROVED') return false

  const requestStart = s(request?.startDate)
  if (!isValidYMD(requestStart)) return false

  return requestStart >= startYMD && requestStart <= endYMD
}

function sumDaysByType(code, docs = []) {
  const target = up(code)

  return (Array.isArray(docs) ? docs : [])
    .filter((r) => up(r?.leaveTypeCode) === target)
    .reduce((acc, r) => acc + num(r?.totalDays), 0)
}

function computeBalances(profile, approvedRequests = [], now = new Date(), opts = {}) {
  const asOfYMD =
    opts?.asOfYMD && isValidYMD(opts.asOfYMD)
      ? s(opts.asOfYMD)
      : toYMD(now)

  const asOfDate = toDateFromYMD(asOfYMD) || now || new Date()

  const { startYMD, endYMD, activeContract } = computeContractYearPeriod(
    profile,
    asOfDate,
    {
      asOfYMD,
      contractId: opts?.contractId ?? null,
      contractNo: opts?.contractNo ?? null,
    }
  )

  const approvedInPeriod = (Array.isArray(approvedRequests) ? approvedRequests : []).filter(
    (r) => requestIsApprovedInPeriod(r, startYMD, endYMD)
  )

  const usedAL = sumDaysByType('AL', approvedInPeriod)
  const usedSP = sumDaysByType('SP', approvedInPeriod)
  const usedMC = sumDaysByType('MC', approvedInPeriod)
  const usedMA = sumDaysByType('MA', approvedInPeriod)
  const usedUL = sumDaysByType('UL', approvedInPeriod)
  const usedBL = sumDaysByType('BL', approvedInPeriod)

  const AL_ENT = computeALByServiceYears(profile?.joinDate, asOfDate)
  const SP_ENT = 7
  const MC_ENT = 90
  const MA_ENT = 90

  const carryRaw = getActiveCarry(profile, {
    contractId: opts?.contractId ?? null,
    contractNo: opts?.contractNo ?? null,
    asOf: asOfYMD,
    contractDate: profile?.contractDate,
  })

  const carry = {
    AL: num(carryRaw?.AL),
    SP: num(carryRaw?.SP),
    MC: num(carryRaw?.MC),
    MA: num(carryRaw?.MA),
    UL: num(carryRaw?.UL),
    BL: num(carryRaw?.BL),
  }

  /*
    RAW balance rule:
    - Do not apply carry here.
    - Carry is applied only in response display:
      decorateProfileForResponse() / applyCarryToBalancesForDisplay()
  */

  const totalSPUsed = usedSP

  // SP borrows from AL, so AL used includes SP.
  const totalALUsed = usedAL + usedSP

  const spRemaining = Math.max(0, SP_ENT - totalSPUsed)
  const alRemaining = AL_ENT - totalALUsed

  const mcRemaining = MC_ENT - usedMC
  const maRemaining = MA_ENT - usedMA

  return {
    balances: [
      {
        leaveTypeCode: 'AL',
        yearlyEntitlement: AL_ENT,
        used: totalALUsed,
        remaining: alRemaining,
      },
      {
        leaveTypeCode: 'SP',
        yearlyEntitlement: SP_ENT,
        used: totalSPUsed,
        remaining: spRemaining,
      },
      {
        leaveTypeCode: 'MC',
        yearlyEntitlement: MC_ENT,
        used: usedMC,
        remaining: mcRemaining,
      },
      {
        leaveTypeCode: 'MA',
        yearlyEntitlement: MA_ENT,
        used: usedMA,
        remaining: maRemaining,
      },
      {
        leaveTypeCode: 'UL',
        yearlyEntitlement: 0,
        used: usedUL,
        remaining: 0,
      },
      {
        leaveTypeCode: 'BL',
        yearlyEntitlement: 0,
        used: usedBL,
        remaining: 0,
      },
    ],
    meta: {
      asOfYMD,
      contractYear: {
        startDate: startYMD,
        endDate: endYMD,
      },
      activeContract: activeContract
        ? {
            contractNo: activeContract.contractNo,
            startDate: activeContract.startDate,
            endDate: activeContract.endDate,
          }
        : null,
      contractDate: isValidYMD(profile?.contractDate) ? s(profile.contractDate) : null,
      joinDate: isValidYMD(profile?.joinDate) ? s(profile.joinDate) : null,
      serviceYears: serviceYearsFromJoin(profile?.joinDate, asOfDate),
      carry,
      approvedCount: approvedInPeriod.length,
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