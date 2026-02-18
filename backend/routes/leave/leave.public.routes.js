const router = require('express').Router()
const ctrl = require('../../controllers/leave/leave.public.controller')

router.get('/holidays', ctrl.listHolidays)

module.exports = router