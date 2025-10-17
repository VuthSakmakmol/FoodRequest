const express = require('express')
const router = express.Router()
const ctrl = require('../../controllers/transportation/transportRecurring.controller')

// add your auth middleware here if needed, e.g. router.use(auth)

router.get('/preview', ctrl.preview)
router.post('/', ctrl.createSeries)
router.post('/:id/cancel-remaining', ctrl.cancelRemaining)

module.exports = router
