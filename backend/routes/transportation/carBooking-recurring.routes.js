const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/transportRecurring.controller')

// router.use(auth) // ← ensure auth before createSeries
router.get('/preview', ctrl.preview)
router.post('/', ctrl.createSeries)
router.post('/:id/cancel-remaining', ctrl.cancelRemaining)

module.exports = router
