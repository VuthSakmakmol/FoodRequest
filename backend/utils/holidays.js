// backend/utils/holidays.js
const dayjs = require('dayjs')

function parseHolidaySet() {
  const list = String(process.env.HOLIDAYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return new Set(list)
}

const HOLIDAY_SET = parseHolidaySet()

function isSunday(dateStr) {
  return dayjs(dateStr).day() === 0 // 0 = Sunday
}

function isHoliday(dateStr) {
  return isSunday(dateStr) || HOLIDAY_SET.has(dateStr)
}

function getHolidayArray() {
  return Array.from(HOLIDAY_SET)
}

module.exports = { HOLIDAY_SET, isSunday, isHoliday, getHolidayArray }
