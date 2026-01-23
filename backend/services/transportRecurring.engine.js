//backend/services/transportRecurring.engine.js
const CarBooking = require('../models/transportation/CarBooking')
const Series = require('../models/transportation/TransportationRecurringSeries')
const { enumerateLocalDates } = require('../utils/datetime')
const { getHolidaySet, isSunday } = require('../utils/holidays')
const { makeIdempotencyKey, naturalKeyFilter } = require('../utils/transportRecurringKey')

const ZONE = 'Asia/Phnom_Penh'

async function expandSeries(seriesId, employeeSnapshot) {
  const series = await Series.findById(seriesId)
  if (!series || series.status !== 'ACTIVE') return { created: 0, skipped: [] }

  const days = enumerateLocalDates(series.startDate, series.endDate, ZONE)

  // ✅ Same skip logic as controller
  const holidays = new Set(await getHolidaySet())
  if (series.skipHolidays) {
    for (const d of days) if (isSunday(d)) holidays.add(d)
  }

  const keep = days.filter((d) => !holidays.has(d))
  const empId = employeeSnapshot?.employeeId || ''

  let created = 0
  const skipped = []

  for (const d of keep) {
    const idk = makeIdempotencyKey(series, d)

    const doc = {
      seriesId: series._id,
      idempotencyKey: idk,

      employeeId: empId,
      employee: {
        employeeId: empId,
        name: employeeSnapshot?.name || '',
        department: employeeSnapshot?.department || '',
        contactNumber: employeeSnapshot?.contactNumber || '',
      },

      category: series.category,
      tripDate: d,
      timeStart: series.timeStart,
      timeEnd: series.timeEnd,

      passengers: series.passengers,
      customerContact: series.customerContact || '',
      stops: series.stops || [],
      purpose: series.purpose || '',
      notes: series.notes || '',
      status: 'PENDING',
    }

    try {
      // ✅ Best protection: matches BOTH new + old docs
      const filter = {
        $or: [
          { idempotencyKey: idk },
          naturalKeyFilter(series, empId, d),
        ],
      }

      const res = await CarBooking.updateOne(
        filter,
        { $setOnInsert: doc },
        { upsert: true }
      )

      if (res.upsertedCount) created += 1
      else skipped.push(d)
    } catch (e) {
      skipped.push(d)
    }
  }

  return { created, skipped }
}

async function expandAllActive() {
  const list = await Series.find({ status: 'ACTIVE' })
  let total = 0
  for (const s of list) {
    const r = await expandSeries(s._id, s.createdByEmp)
    total += r.created
  }
  return total
}

module.exports = { expandSeries, expandAllActive }
