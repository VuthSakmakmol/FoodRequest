// backend/utils/time.js
const dayjs = require('dayjs')

function toMinutes(hhmm) {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + (m || 0)
}
function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd }
function isValidDate(s) { return dayjs(s, 'YYYY-MM-DD', true).isValid() }

module.exports = { toMinutes, overlaps, isValidDate }
