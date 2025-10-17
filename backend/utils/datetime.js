const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const tz = require('dayjs/plugin/timezone')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')

dayjs.extend(utc); dayjs.extend(tz); dayjs.extend(isSameOrBefore)

/** Inclusive list of YYYY-MM-DD between start..end in a timezone */
function enumerateLocalDates(startDate, endDate, timezone) {
  const out = []
  let d = dayjs.tz(startDate, timezone).startOf('day')
  const end = dayjs.tz(endDate, timezone).startOf('day')
  for (; d.isSameOrBefore(end); d = d.add(1, 'day')) out.push(d.format('YYYY-MM-DD'))
  return out
}

/** Simple normalizer for time strings like "7:0" -> "07:00" */
function padTimeHHMM(timeStr='00:00') {
  const [h='00', m='00'] = String(timeStr).split(':')
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

module.exports = { enumerateLocalDates, padTimeHHMM }
