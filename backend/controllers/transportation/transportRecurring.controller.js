const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc); dayjs.extend(tz);

const Series = require('../../models/transportation/TransportationRecurringSeries');
const CarBooking = require('../../models/transportation/CarBooking');

const { enumerateLocalDates, padTimeHHMM } = require('../../utils/datetime');
const { getHolidaySet, isSunday } = require('../../utils/holidays');
const { notify } = require('../../services/transport.telegram.notify');

const ZONE = 'Asia/Phnom_Penh';
const MAX_DAYS = Number(process.env.MAX_RECURRING_DAYS || 30);

/* ---------- helpers ---------- */
const asBool = (v) => ['true','1','yes','y','on'].includes(String(v).toLowerCase());

function addMinutes(hhmm, minutes = 60) {
  const [h='0', m='0'] = String(hhmm || '').split(':');
  const base = dayjs().hour(+h).minute(+m).second(0).millisecond(0);
  return base.add(Number(minutes || 0), 'minute').format('HH:mm');
}

/* ======================================================================== */
/* CREATE SERIES (and materialize CarBooking docs, skipping holidays/Sundays) */
async function createSeries(req, res) {
  try {
    const body = { ...(req.body || {}) };

    // defaults / normalization
    if (!body.createdByEmp) {
      body.createdByEmp = { employeeId: '', name: '', department: '', contactNumber: '' };
    }
    body.timeStart = padTimeHHMM(body.timeStart);
    body.timeEnd   = padTimeHHMM(body.timeEnd);
    body.skipHolidays = asBool(body.skipHolidays);
    body.category = body.category || 'Car';
    body.passengers = Number(body.passengers || 1);
    body.durationMin = Number(body.durationMin || 60);

    // validations
    if (!Array.isArray(body.stops) || body.stops.length === 0) {
      return res.status(400).json({ ok: false, error: 'At least one destination (stop) is required.' });
    }
    for (const s of body.stops) {
      if (s.destination === 'Other' && !s.destinationOther) {
        return res.status(400).json({ ok: false, error: 'destinationOther is required when destination is "Other".' });
      }
    }

    if (!body.startDate || !body.endDate) {
      return res.status(400).json({ ok: false, error: 'startDate and endDate are required.' });
    }
    if (!body.timeStart || !body.timeEnd) {
      return res.status(400).json({ ok: false, error: 'timeStart and timeEnd are required.' });
    }
    if (body.timeStart >= body.timeEnd) {
      return res.status(400).json({ ok: false, error: 'timeEnd must be after timeStart.' });
    }

    let s = dayjs.tz(body.startDate, ZONE).startOf('day');
    let e = dayjs.tz(body.endDate, ZONE).startOf('day');
    if (!s.isValid() || !e.isValid()) {
      return res.status(400).json({ ok: false, error: 'Invalid start/end date.' });
    }

    const spanDays = e.diff(s, 'day') + 1;
    if (spanDays > MAX_DAYS) {
      e = s.add(MAX_DAYS - 1, 'day');
      body.endDate = e.format('YYYY-MM-DD');
    }

    // Persist the series document first
    const series = await Series.create(body);

    // Enumerate dates and compute Holidays
    const days = enumerateLocalDates(series.startDate, series.endDate, ZONE);
    const holidayBase = await getHolidaySet();
    const holidays = new Set(holidayBase);
    if (series.skipHolidays) {
      for (const d of days) if (isSunday(d)) holidays.add(d);
    }

    const keptDates    = days.filter(d => !holidays.has(d));
    const skippedDates = days.filter(d =>  holidays.has(d));

    // Derive timeEnd if caller provided a duration instead of explicit end
    const timeEnd = series.timeEnd || addMinutes(series.timeStart, body.durationMin);

    // --- NEW: skip creating duplicate for today's booking ---
    const baseDate = dayjs(series.startDate).format('YYYY-MM-DD');

    const createdIds = [];
    for (const d of keptDates) {
      if (d === baseDate) continue; // ⛔ Skip today (already has initial booking)

      const doc = await CarBooking.create({
        seriesId: series._id,
        employeeId: series.createdByEmp?.employeeId || '',
        employee:   series.createdByEmp || { employeeId: '' },

        category: series.category || 'Car',
        tripDate: d,
        timeStart: series.timeStart,
        timeEnd:   timeEnd,

        passengers: series.passengers || 1,
        customerContact: series.customerContact || '',
        stops: Array.isArray(series.stops) ? series.stops : [],
        purpose: series.purpose || '',
        notes: series.notes || '',

        status: 'PENDING'
      });
      createdIds.push(doc._id);
    }

    // notify (best effort)
    try {
      await notify('SERIES_CREATED', {
        seriesId: series._id,
        created: createdIds.length,
        skipped: skippedDates.length,
        sampleDates: skippedDates.slice(0, 5),
        createdByEmp: series.createdByEmp || {}
      });
    } catch (err) {
      console.warn('[notify SERIES_CREATED failed]', err.message);
    }

    return res.json({
      ok: true,
      seriesId: series._id,
      created: createdIds.length,
      skipped: skippedDates.length,
      createdDates: keptDates.filter(d => d !== baseDate),
      skippedDates
    });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
}

/* ======================================================================== */
/* PREVIEW series with the same rules used in createSeries */
async function preview(req, res) {
  try {
    const { start, end, timeStart, skipHolidays = 'true' } = req.query;
    if (!start || !end || !timeStart) {
      return res.status(400).json({ ok: false, error: 'start, end, and timeStart are required.' });
    }

    const days = enumerateLocalDates(start, end, ZONE);
    const base = await getHolidaySet();

    const holidays = new Set(base);
    if (asBool(skipHolidays)) {
      for (const d of days) if (isSunday(d)) holidays.add(d);
    }

    const kept    = days.filter(d => !holidays.has(d));
    const skipped = days.filter(d =>  holidays.has(d));

    return res.json({ ok: true, dates: kept, skipped });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
}

/* ======================================================================== */
/* CANCEL remaining future bookings in a recurring series */
async function cancelRemaining(req, res) {
  try {
    const { id } = req.params;
    const series = await Series.findById(id);
    if (!series) return res.status(404).json({ ok: false, error: 'Series not found' });

    series.status = 'CANCELLED';
    await series.save();

    const todayStr = dayjs().tz(ZONE).format('YYYY-MM-DD');
    const upd = await CarBooking.updateMany(
      { seriesId: id, tripDate: { $gt: todayStr }, status: { $ne: 'CANCELLED' } },
      { $set: { status: 'CANCELLED', notes: 'Cancelled by recurring series' } }
    );

    try { 
      await notify('SERIES_CANCELLED', { seriesId: id, affected: upd.modifiedCount || 0 }); 
    } catch (err) {
      console.warn('[notify SERIES_CANCELLED failed]', err.message);
    }

    return res.json({ ok: true, affected: upd.modifiedCount || 0 });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
}

module.exports = { createSeries, preview, cancelRemaining };
