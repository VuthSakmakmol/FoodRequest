// backend/services/transportRecurring.engine.js
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const tz = require('dayjs/plugin/timezone')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
dayjs.extend(utc); dayjs.extend(tz); dayjs.extend(isSameOrBefore)

const Series = require('../models/transportation/TransportationRecurringSeries')
const CarBooking = require('../models/transportation/CarBooking')
const { enumerateLocalDates } = require('../utils/datetime')
const { getHolidaySet, isSunday } = require('../utils/holidays')

const ZONE = 'Asia/Phnom_Penh'
const MAX_DAYS = Number(process.env.MAX_RECURRING_DAYS || 30)

function seriesKey(seriesId, dateStr) {
  return `series:${String(seriesId)}:${dateStr}`
}

async function expandSeries(seriesId, createdByEmpFromController = null) {
  const series = await Series.findById(seriesId).lean()
  if (!series) throw new Error('Series not found')
  if (series.status !== 'ACTIVE') return { ok: true, created: 0, skipped: ['Series not ACTIVE'] }

  const s = dayjs.tz(series.startDate, ZONE).startOf('day')
  const e = dayjs.tz(series.endDate, ZONE).startOf('day')
  if (!s.isValid() || !e.isValid()) throw new Error('Invalid start/end date')

  const spanDays = e.diff(s, 'day') + 1
  const clampedEnd = spanDays > MAX_DAYS ? s.add(MAX_DAYS - 1, 'day') : e
  const endStr = clampedEnd.format('YYYY-MM-DD')
  const allDates = enumerateLocalDates(series.startDate, endStr, ZONE)

  const baseHolidaySet = await getHolidaySet()
  const holidays = new Set(baseHolidaySet)
  if (series.skipHolidays) for (const d of allDates) if (isSunday(d)) holidays.add(d)

  const createdDates = []
  const skippedDates = []
  const skippedReasons = []

  const createdByEmp = series.createdByEmp || createdByEmpFromController || {
    employeeId: '',
    name: '',
    department: '',
    contactNumber: '',
  }
  if (!createdByEmp?.employeeId) throw new Error('createdByEmp.employeeId missing; cannot create CarBooking')

  for (const d of allDates) {
    if (series.skipHolidays && holidays.has(d)) { skippedDates.push(d); continue }

    const idem = seriesKey(series._id, d)
    const payload = {
      seriesId: series._id,
      idempotencyKey: idem,

      employeeId: createdByEmp.employeeId,
      employee: {
        employeeId: createdByEmp.employeeId,
        name: createdByEmp.name || '',
        department: createdByEmp.department || '',
        contactNumber: createdByEmp.contactNumber || '',
      },

      category: series.category,
      tripDate: d,
      timeStart: series.timeStart,
      timeEnd: series.timeEnd,

      passengers: series.passengers || 1,
      customerContact: series.customerContact || '',
      stops: Array.isArray(series.stops) ? series.stops : [],
      purpose: series.purpose || '',
      notes: series.notes || '',

      status: 'PENDING',
    }

    try {
      await CarBooking.create(payload)
      createdDates.push(d)
    } catch (e) {
      if (e?.code === 11000) {
        skippedDates.push(d); skippedReasons.push({ date: d, reason: 'duplicate' })
      } else {
        skippedDates.push(d); skippedReasons.push({ date: d, reason: e.message || 'DB error' })
      }
    }
  }

  return {
    ok: true,
    created: createdDates.length,
    createdDates,
    skipped: skippedDates,
    skippedReasons,
    spanClampedTo: endStr !== series.endDate ? endStr : undefined,
  }
}

async function expandTodayIfMissing() {
  const today = dayjs().tz(ZONE).format('YYYY-MM-DD')
  const active = await Series.find({
    status: 'ACTIVE',
    startDate: { $lte: today },
    endDate: { $gte: today },
  }).lean()

  if (!active.length) return { scanned: 0, created: 0 }

  const baseHolidaySet = await getHolidaySet()
  let created = 0

  for (const s of active) {
    if (s.skipHolidays && (baseHolidaySet.has(today) || isSunday(today))) continue
    const idem = seriesKey(s._id, today)
    const exists = await CarBooking.findOne({ idempotencyKey: idem }).lean()
    if (exists) continue

    const emp = s.createdByEmp || {}
    if (!emp.employeeId) continue

    try {
      await CarBooking.create({
        seriesId: s._id, idempotencyKey: idem,
        employeeId: emp.employeeId,
        employee: {
          employeeId: emp.employeeId,
          name: emp.name || '',
          department: emp.department || '',
          contactNumber: emp.contactNumber || '',
        },
        category: s.category,
        tripDate: today,
        timeStart: s.timeStart,
        timeEnd: s.timeEnd,
        passengers: s.passengers || 1,
        customerContact: s.customerContact || '',
        stops: Array.isArray(s.stops) ? s.stops : [],
        purpose: s.purpose || '',
        notes: s.notes || '',
        status: 'PENDING',
      })
      created++
    } catch (e) {
      if (e?.code !== 11000) console.warn('[transportRecurring] create failed:', e?.message)
    }
  }

  return { scanned: active.length, created }
}

function startRecurringEngine(io) {
  const everyMs = Number(process.env.RECURRING_TICK_MS || 60_000)
  console.log(`[transportRecurring] engine started (${everyMs}ms)`)
  const tick = async () => {
    try {
      const res = await expandTodayIfMissing()
      if (res.created > 0 && io) io.emit('transport:recurring:createdToday', res)
    } catch (e) { console.error('[transportRecurring] tick error:', e?.message) }
  }
  tick()
  const handle = setInterval(tick, everyMs)
  return () => clearInterval(handle)
}

module.exports = { expandSeries, startRecurringEngine }
