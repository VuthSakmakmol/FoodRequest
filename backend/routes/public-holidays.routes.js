// backend/routes/public-holidays.routes.js
const router = require('express').Router()
const { getHolidayArray } = require('../utils/holidays')

router.get('/holidays', (_req, res) => {
  res.json({
    tz: process.env.TZ || 'UTC',
    holidays: getHolidayArray(), // e.g. ["2025-01-01", "2025-11-01"]
  })
})

module.exports = router
