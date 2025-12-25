// backend/utils/transportRecurringKey.js
const { padTimeHHMM } = require('./datetime')

function stopsSignature(stops = []) {
  return (stops || [])
    .map((s) => `${s.destination || ''}|${s.destinationOther || ''}`)
    .join('>')
}

function makeIdempotencyKey(series, ymd) {
  return [
    String(series._id),
    String(ymd),
    padTimeHHMM(series.timeStart),
    padTimeHHMM(series.timeEnd),
    String(series.category || ''),
    String(series.passengers || 1),
    stopsSignature(series.stops || []),
  ].join('||')
}

// Fallback for OLD docs created without idempotencyKey
function naturalKeyFilter(series, employeeId, ymd) {
  return {
    seriesId: series._id,
    employeeId: String(employeeId || ''),
    tripDate: String(ymd),
    category: series.category,
    timeStart: padTimeHHMM(series.timeStart),
    timeEnd: padTimeHHMM(series.timeEnd),
  }
}

module.exports = { makeIdempotencyKey, naturalKeyFilter }
