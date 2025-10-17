// backend/controllers/transportRecurring.controller.js
const Series = require('../../models/transportation/TransportationRecurringSeries')
const CarBooking = require('../../models/transportation/CarBooking')
const { enumerateLocalDates, padTimeHHMM } = require('../../utils/datetime')
const { getHolidaySet } = require('../../utils/holidays')
const { expandSeries } = require('../../services/transportRecurring.engine')
const { notify } = require('../../services/transport.telegram.notify')   // <-- ADD

// POST /api/transport/recurring
async function createSeries(req, res) {
  try {
    const body = req.body || {}
    if (req.user?._id) body.createdBy = req.user._id
    if (req.user?.employeeId) {
      body.createdByEmp = {
        employeeId: req.user.employeeId,
        name: req.user.name || '',
        department: req.user.department || '',
        contactNumber: req.user.contactNumber || ''
      }
    } else if (!body.createdByEmp) {
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

    const series = await Series.create(body)
    const result = await expandSeries(series._id, series.createdByEmp)

    // Group-only summary (avoid spamming drivers at series creation)
    try {
      await notify('SERIES_CREATED', {
        seriesId: series._id,
        created: result.created,
        skipped: (result.skipped || []).length,
        sampleDates: (result.skipped || []).slice(0, 5)
      })
    } catch {}

    res.json({ ok: true, seriesId: series._id, ...result })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

// GET /api/transport/recurring/preview?start=YYYY-MM-DD&end=YYYY-MM-DD&timeStart=HH:mm&skipHolidays=true
async function preview(req, res) {
  try {
    const { start, end, timeStart, skipHolidays = 'true' } = req.query
    if (!start || !end || !timeStart) {
      return res.status(400).json({ ok: false, error: 'start, end, and timeStart are required.' })
    }
    const holidays = (String(skipHolidays) === 'true') ? await getHolidaySet() : new Set()
    const days = enumerateLocalDates(start, end, 'Asia/Phnom_Penh')
    const kept = days.filter(d => !holidays.has(d))
    const skipped = days.filter(d => holidays.has(d))
    res.json({ ok: true, dates: kept, skipped })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

// POST /api/transport/recurring/:id/cancel-remaining
async function cancelRemaining(req, res) {
  try {
    const { id } = req.params
    const series = await Series.findById(id)
    if (!series) return res.status(404).json({ ok: false, error: 'Series not found' })

    series.status = 'CANCELLED'
    await series.save()

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    const upd = await CarBooking.updateMany(
      { seriesId: id, tripDate: { $gt: todayStr }, status: { $ne: 'CANCELLED' } },
      { $set: { status: 'CANCELLED', notes: 'Cancelled by recurring series' } }
    )

    try { await notify('SERIES_CANCELLED', { seriesId: id, affected: upd.modifiedCount || 0 }) } catch {}

    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
}

module.exports = { createSeries, preview, cancelRemaining }
