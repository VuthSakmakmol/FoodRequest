/* eslint-disable no-console */
// backend/controllers/leave/leave.public.controller.js

function parseHolidayEnv() {
  return String(process.env.HOLIDAYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
}

exports.listHolidays = async (req, res) => {
  // Just return the configured holiday list (YYYY-MM-DD)
  const days = parseHolidayEnv()
  return res.json({ items: days })
}