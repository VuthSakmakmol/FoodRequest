// backend/utils/holidays.js
const dayjs = require('dayjs')

function parseHolidaySet() {
  const list = String(process.env.HOLIDAYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return new Set(list)
}

let HOLIDAY_SET = parseHolidaySet()

/** Rebuild the set (in case env changes during runtime — optional) */
function reloadHolidaySet() {
  HOLIDAY_SET = parseHolidaySet()
  return HOLIDAY_SET
}

function isSunday(dateStr) {
  return dayjs(dateStr).day() === 0 // 0 = Sunday
}

/** Env-based public holiday set (Sundays not automatically included here) */
async function getHolidaySet() {
  // If you later store holidays in DB, fetch+merge here.
  return new Set(HOLIDAY_SET)
}

function isHoliday(dateStr) {
  // NOTE: This includes Sunday; `getHolidaySet()` alone does NOT.
  // Some callers want Sunday added separately to mirror UI toggles.
  return isSunday(dateStr) || HOLIDAY_SET.has(dateStr)
}

function getHolidayArray() {
  return Array.from(HOLIDAY_SET)
}

module.exports = { HOLIDAY_SET, reloadHolidaySet, isSunday, isHoliday, getHolidayArray, getHolidaySet }
