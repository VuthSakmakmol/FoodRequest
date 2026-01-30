// backend/utils/transportRecurringKey.js
function makeIdempotencyKey(seriesId, tripDate) {
  const sid = String(seriesId || '').trim()
  const d = String(tripDate || '').trim()
  return sid && d ? `TRX:TRANS:SERIES:${sid}:${d}` : ''
}

module.exports = { makeIdempotencyKey }
