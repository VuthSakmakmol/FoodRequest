// backend/controllers/transportation/transportRecurring.controller.js
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const tz = require('dayjs/plugin/timezone')
dayjs.extend(utc)
dayjs.extend(tz)

const Series = require('../../models/transportation/TransportationRecurringSeries')
const CarBooking = require('../../models/transportation/CarBooking')

const { enumerateLocalDates, padTimeHHMM } = require('../../utils/datetime')
const { getHolidaySet, isSunday } = require('../../utils/holidays')
const { notify } = require('../../services/transport.telegram.notify')
const { broadcastCarBooking, ROOMS, emitToRoom } = require('../../utils/realtime')

// ✅ single source of truth for recurring key + fallback protection
const {
  makeIdempotencyKey,
  naturalKeyFilter,
} = require('../../utils/transportRecurringKey')

const ZONE = 'Asia/Phnom_Penh'
const MAX_DAYS = Number(process.env.MAX_RECURRING_DAYS || 30)

/* ---------- helpers ---------- */
const asBool = (v) =>
  ['true', '1', 'yes', 'y', 'on'].includes(String(v).toLowerCase())

function addMinutes(hhmm, minutes = 60) {
  const [h = '0', m = '0'] = String(hhmm || '').split(':')
  const base = dayjs().hour(+h).minute(+m).second(0).millisecond(0)
  return base.add(Number(minutes || 0), 'minute').format('HH:mm')
}

/* ======================================================================== */
/* CREATE SERIES (and materialize CarBooking docs, skipping holidays/Sundays) */
async function createSeries(req, res) {
  try {
    const io = req.io
    const body = { ...(req.body || {}) }

    // defaults / normalization
    if (!body.createdByEmp) {
      body.createdByEmp = {
        employeeId: '',
        name: '',
        department: '',
        contactNumber: '',
      }
    }

    body.category = body.category || 'Car'
    body.passengers = Number(body.passengers || 1)
    body.durationMin = Number(body.durationMin || 60)
    body.skipHolidays = asBool(body.skipHolidays)

    body.timeStart = padTimeHHMM(body.timeStart)

    // ✅ allow timeEnd omitted if durationMin is provided
    body.timeEnd = body.timeEnd
      ? padTimeHHMM(body.timeEnd)
      : addMinutes(body.timeStart, body.durationMin)

    // validations
    if (!Array.isArray(body.stops) || body.stops.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'At least one destination (stop) is required.' })
    }
    for (const s of body.stops) {
      if (!s?.destination) {
        return res.status(400).json({
          ok: false,
          error: 'destination is required for each stop.',
        })
      }
      if (s.destination === 'Other' && !s.destinationOther) {
        return res.status(400).json({
          ok: false,
          error: 'destinationOther is required when destination is "Other".',
        })
      }
    }

    if (!body.startDate || !body.endDate) {
      return res
        .status(400)
        .json({ ok: false, error: 'startDate and endDate are required.' })
    }

    if (!body.timeStart || !body.timeEnd) {
      return res
        .status(400)
        .json({ ok: false, error: 'timeStart and timeEnd are required.' })
    }

    if (body.timeStart >= body.timeEnd) {
      return res
        .status(400)
        .json({ ok: false, error: 'timeEnd must be after timeStart.' })
    }

    let s = dayjs.tz(body.startDate, ZONE).startOf('day')
    let e = dayjs.tz(body.endDate, ZONE).startOf('day')
    if (!s.isValid() || !e.isValid()) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid start/end date.' })
    }

    const spanDays = e.diff(s, 'day') + 1
    if (spanDays > MAX_DAYS) {
      e = s.add(MAX_DAYS - 1, 'day')
      body.endDate = e.format('YYYY-MM-DD')
    }

    // Persist series (schema requires timeEnd, so we must set it above)
    const series = await Series.create(body)

    // Enumerate dates and compute Holidays/Sundays
    const days = enumerateLocalDates(series.startDate, series.endDate, ZONE)

    const holidayBase = await getHolidaySet()
    const holidays = new Set(holidayBase)

    // ✅ when skipHolidays=true, also skip Sundays
    if (series.skipHolidays) {
      for (const d of days) if (isSunday(d)) holidays.add(d)
    }

    const keptDates = days.filter((d) => !holidays.has(d))
    const skippedDates = days.filter((d) => holidays.has(d))

    // Keep your old rule: skip baseDate (because UI already created today’s booking)
    const baseDate = dayjs(series.startDate).format('YYYY-MM-DD')

    // ✅ BEST FIX: upsert with idempotencyKey OR natural key
    const createdIds = []
    const createdDates = []
    const empId = series.createdByEmp?.employeeId || ''

    for (const d of keptDates) {
      if (d === baseDate) continue

      const idk = makeIdempotencyKey(series, d)

      const insertDoc = {
        seriesId: series._id,
        idempotencyKey: idk,

        employeeId: empId,
        employee: series.createdByEmp || { employeeId: empId },

        category: series.category || 'Car',
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

      const resUpsert = await CarBooking.updateOne(
        {
          $or: [
            { idempotencyKey: idk },
            naturalKeyFilter(series, empId, d),
          ],
        },
        { $setOnInsert: insertDoc },
        { upsert: true }
      )

      // only count/broadcast if newly inserted
      if (resUpsert?.upsertedCount) {
        createdDates.push(d)

        // fetch the inserted doc for realtime + ids
        const createdDoc = await CarBooking.findOne({ idempotencyKey: idk }).lean()
        if (createdDoc?._id) createdIds.push(createdDoc._id)

        if (io && createdDoc) {
          // mimic your carBooking created payload style
          const payload = {
            _id: String(createdDoc._id),
            employeeId: createdDoc.employeeId,
            category: createdDoc.category,
            tripDate: createdDoc.tripDate,
            timeStart: createdDoc.timeStart,
            timeEnd: createdDoc.timeEnd,
            status: createdDoc.status,
          }
          broadcastCarBooking(io, createdDoc, 'carBooking:created', payload)
        }
      }
    }

    // notify (best effort)
    try {
      await notify('SERIES_CREATED', {
        seriesId: series._id,
        created: createdDates.length,
        skipped: skippedDates.length,
        sampleDates: skippedDates.slice(0, 5),
        createdByEmp: series.createdByEmp || {},
      })
    } catch (err) {
      console.warn('[notify SERIES_CREATED failed]', err.message)
    }

    return res.json({
      ok: true,
      seriesId: series._id,
      created: createdDates.length,
      skipped: skippedDates.length,
      createdDates,
      skippedDates,
    })
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message })
  }
}

/* ======================================================================== */
/* PREVIEW series with the same rules used in createSeries */
async function preview(req, res) {
  try {
    const { start, end, timeStart, skipHolidays = 'true' } = req.query
    if (!start || !end || !timeStart) {
      return res.status(400).json({
        ok: false,
        error: 'start, end, and timeStart are required.',
      })
    }

    const days = enumerateLocalDates(start, end, ZONE)
    const base = await getHolidaySet()

    const holidays = new Set(base)
    if (asBool(skipHolidays)) {
      for (const d of days) if (isSunday(d)) holidays.add(d)
    }

    const kept = days.filter((d) => !holidays.has(d))
    const skipped = days.filter((d) => holidays.has(d))

    return res.json({ ok: true, dates: kept, skipped })
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message })
  }
}

/* ======================================================================== */
/* CANCEL remaining future bookings in a recurring series */
async function cancelRemaining(req, res) {
  try {
    const io = req.io
    const { id } = req.params
    const series = await Series.findById(id)
    if (!series)
      return res.status(404).json({ ok: false, error: 'Series not found' })

    series.status = 'CANCELLED'
    await series.save()

    const todayStr = dayjs().tz(ZONE).format('YYYY-MM-DD')
    const upd = await CarBooking.updateMany(
      { seriesId: id, tripDate: { $gt: todayStr }, status: { $ne: 'CANCELLED' } },
      { $set: { status: 'CANCELLED', notes: 'Cancelled by recurring series' } }
    )

    const affected = upd.modifiedCount || 0

    // 🔄 Realtime summary for admins + original requester
    if (io) {
      const payload = { seriesId: id, affected }

      // All admins can refresh their calendars
      emitToRoom(io, ROOMS.ADMINS, 'recurring:seriesCancelled', payload)

      // Original employee (creator of the series)
      const empId = series.createdByEmp?.employeeId || ''
      if (empId) {
        emitToRoom(io, ROOMS.EMPLOYEE(empId), 'recurring:seriesCancelled', payload)
      }
    }

    try {
      await notify('SERIES_CANCELLED', { seriesId: id, affected })
    } catch (err) {
      console.warn('[notify SERIES_CANCELLED failed]', err.message)
    }

    return res.json({ ok: true, affected })
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message })
  }
}

module.exports = { createSeries, preview, cancelRemaining }
