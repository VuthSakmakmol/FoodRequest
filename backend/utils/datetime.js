//backend/utils/datetime.js
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const tz = require('dayjs/plugin/timezone')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
dayjs.extend(utc); dayjs.extend(tz); dayjs.extend(isSameOrBefore)

function enumerateLocalDates(startDate, endDate, timezone = 'Asia/Phnom_Penh') {
  const out = []
  let d = dayjs.tz(startDate, timezone).startOf('day')
  const end = dayjs.tz(endDate, timezone).startOf('day')
  for (; d.isSameOrBefore(end); d = d.add(1, 'day')) out.push(d.format('YYYY-MM-DD'))
  return out
}

function padTimeHHMM(timeStr='00:00') {
  const [h='00', m='00'] = String(timeStr).split(':')
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

module.exports = { enumerateLocalDates, padTimeHHMM }
