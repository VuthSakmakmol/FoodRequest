// backend/controllers/transportation/transportRecurring.controller.js
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const tz = require('dayjs/plugin/timezone')
dayjs.extend(utc); dayjs.extend(tz)

const Series = require('../../models/transportation/TransportationRecurringSeries')
const CarBooking = require('../../models/transportation/CarBooking')
const { enumerateLocalDates, padTimeHHMM } = require('../../utils/datetime')
const { getHolidaySet, isSunday } = require('../../utils/holidays')
const { expandSeries } = require('../../services/transportRecurring.engine')
const { notify } = require('../../services/transport.telegram.notify')

const ZONE = 'Asia/Phnom_Penh'
const MAX_DAYS = Number(process.env.MAX_RECURRING_DAYS || 30)

async function createSeries(req, res) {
  try {
    const body = req.body || {}

    if (!body.createdByEmp) {
      body.createdByEmp = { employeeId: '', name: '', department: '', contactNumber: '' }
    }

    body.timeStart = padTimeHHMM(body.timeStart)
    body.timeEnd   = padTimeHHMM(body.timeEnd)

    if (!Array.isArray(body.stops) || body.stops.length === 0)
      return res.status(400).json({ ok: false, error: 'At least one destination (stop) is required.' })
    for (const s of body.stops) {
      if (s.destination === 'Other' && !s.destinationOther)
        return res.status(400).json({ ok: false, error: 'destinationOther is required when destination is "Other".' })
    }

    if (!body.startDate || !body.endDate) return res.status(400).json({ ok: false, error: 'startDate and endDate are required.' })
    if (!body.timeStart || !body.timeEnd) return res.status(400).json({ ok: false, error: 'timeStart and timeEnd are required.' })
    if (body.timeStart >= body.timeEnd) return res.status(400).json({ ok: false, error: 'timeEnd must be after timeStart.' })

    const s = dayjs.tz(body.startDate, ZONE).startOf('day')
    const e = dayjs.tz(body.endDate, ZONE).startOf('day')
    if (!s.isValid() || !e.isValid()) return res.status(400).json({ ok: false, error: 'Invalid start/end date.' })
    const spanDays = e.diff(s, 'day') + 1
    if (spanDays > MAX_DAYS) body.endDate = s.add(MAX_DAYS - 1, 'day').format('YYYY-MM-DD')

    const series = await Series.create(body)
    const result = await expandSeries(series._id, series.createdByEmp)

    try {
      await notify('SERIES_CREATED', {
        seriesId: series._id,
        created: result.created,
        skipped: (result.skipped || []).length,
        sampleDates: (result.skipped || []).slice(0, 5),
      })
    } catch {}

    res.json({ ok: true, seriesId: series._id, ...result })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

async function preview(req, res) {
  try {
    const { start, end, timeStart, skipHolidays = 'true' } = req.query
    if (!start || !end || !timeStart)
      return res.status(400).json({ ok: false, error: 'start, end, and timeStart are required.' })

    const days = enumerateLocalDates(start, end, ZONE)
    const base = await getHolidaySet()
    const holidays = new Set(base)
    if (String(skipHolidays) === 'true') for (const d of days) if (isSunday(d)) holidays.add(d)

    const kept = days.filter(d => !holidays.has(d))
    const skipped = days.filter(d => holidays.has(d))
    res.json({ ok: true, dates: kept, skipped })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

async function cancelRemaining(req, res) {
  try {
    const { id } = req.params
    const series = await Series.findById(id)
    if (!series) return res.status(404).json({ ok: false, error: 'Series not found' })

    series.status = 'CANCELLED'
    await series.save()

    const todayStr = dayjs().tz(ZONE).format('YYYY-MM-DD')
    const upd = await CarBooking.updateMany(
      { seriesId: id, tripDate: { $gt: todayStr }, status: { $ne: 'CANCELLED' } },
      { $set: { status: 'CANCELLED', notes: 'Cancelled by recurring series' } }
    )

    try { await notify('SERIES_CANCELLED', { seriesId: id, affected: upd.modifiedCount || 0 }) } catch {}

    res.json({ ok: true, affected: upd.modifiedCount || 0 })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

module.exports = { createSeries, preview, cancelRemaining }
