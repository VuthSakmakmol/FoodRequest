//services/transportRecurring.engine.js
const CarBooking = require('../models/transportation/CarBooking')
const Series = require('../models/transportation/TransportationRecurringSeries')
const { enumerateLocalDates, padTimeHHMM } = require('../utils/datetime')
const { getHolidaySet } = require('../utils/holidays')

function makeIdemKey(series, ymd) {
  const stopsSig = (series.stops || [])
    .map(s => `${s.destination}|${s.destinationOther||''}`).join('>')
  return [
    String(series._id), ymd, padTimeHHMM(series.timeStart),
    series.category, String(series.passengers), stopsSig
  ].join('||')
}

async function expandSeries(seriesId, employeeSnapshot) {
  const series = await Series.findById(seriesId)
  if (!series || series.status !== 'ACTIVE') return { created: 0, skipped: [] }

  const holidays = series.skipHolidays ? await getHolidaySet() : new Set()
  const days = enumerateLocalDates(series.startDate, series.endDate, 'Asia/Phnom_Penh')
  const keep = days.filter(d => !holidays.has(d))

  let created = 0, skipped = []
  for (const d of keep) {
    const idk = makeIdemKey(series, d)
    const doc = {
      seriesId: series._id,
      idempotencyKey: idk,

      employeeId: employeeSnapshot?.employeeId || '',
      employee: {
        employeeId: employeeSnapshot?.employeeId || '',
        name: employeeSnapshot?.name || '',
        department: employeeSnapshot?.department || '',
        contactNumber: employeeSnapshot?.contactNumber || ''
      },

      category: series.category,
      tripDate: d,
      timeStart: padTimeHHMM(series.timeStart),
      timeEnd:   padTimeHHMM(series.timeEnd),

      passengers: series.passengers,
      customerContact: series.customerContact || '',
      stops: series.stops || [],
      purpose: series.purpose || '',
      notes: series.notes || '',
      status: 'PENDING'
    }

    try {
      const res = await CarBooking.updateOne(
        { idempotencyKey: idk },
        { $setOnInsert: doc },
        { upsert: true }
      )
      if (res.upsertedCount) created += 1
      else skipped.push(d)
    } catch {
      skipped.push(d)
    }
  }
  return { created, skipped }
}

async function expandAllActive() {
  const list = await Series.find({ status: 'ACTIVE' })
  let total = 0
  for (const s of list) total += (await expandSeries(s._id, s.createdByEmp)).created
  return total
}

module.exports = { expandSeries, expandAllActive }
