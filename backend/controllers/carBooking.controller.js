// backend/controllers/carBooking.controller.js
const CarBooking = require('../models/CarBooking')

// ✅ Create a public car booking (employee)
exports.publicCreateCar = async (req, res, next) => {
  try {
    const {
      employeeId, name,
      pickupTime,
      pickup = {}, dropoff = {},
      passengers = 1,
      note
    } = req.body || {}

    if (!employeeId || !name) {
      return res.status(400).json({ message: 'employeeId and name are required' })
    }
    if (!pickupTime) {
      return res.status(400).json({ message: 'pickupTime is required' })
    }

    const doc = await CarBooking.create({
      type: 'CAR',
      status: 'NEW',
      requester: { employeeId, name },
      pickupTime: new Date(pickupTime),
      pickup: {
        label: pickup.label || '',
        address: pickup.address || '',
        lat: pickup.lat,
        lng: pickup.lng
      },
      dropoff: {
        label: dropoff.label || '',
        address: dropoff.address || ''
      },
      passengers: Number(passengers) || 1,
      note
    })

    // push history
    doc.history.push({
      at: new Date(),
      by: { employeeId, name },
      action: 'CREATE',
      note: 'Public car booking created'
    })
    await doc.save()

    res.status(201).json(doc)
  } catch (e) { next(e) }
}

// ✅ List public bookings by employeeId
exports.publicListByEmployee = async (req, res, next) => {
  try {
    const { employeeId } = req.query
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    const rows = await CarBooking.find({
      type: 'CAR',
      'requester.employeeId': employeeId
    })
    .sort({ createdAt: -1 })
    .limit(50)

    res.json(rows)
  } catch (e) { next(e) }
}

// ✅ Cancel booking (public; requires matching employeeId)
exports.publicCancel = async (req, res, next) => {
  try {
    const { id } = req.params
    const { employeeId, reason } = req.body || {}

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    const b = await CarBooking.findById(id)
    if (!b) return res.status(404).json({ message: 'Not found' })
    if (b.requester?.employeeId !== employeeId) {
      return res.status(403).json({ message: 'Only the requester can cancel this booking' })
    }

    if (!['NEW','ACCEPTED','ON_ROUTE'].includes(b.status)) {
      return res.status(400).json({ message: `Cannot cancel when status=${b.status}` })
    }

    b.status = 'CANCELED'
    if (reason) b.cancelReason = reason
    b.history.push({
      at: new Date(),
      by: { employeeId, name: b.requester?.name },
      action: 'CANCEL',
      note: reason || ''
    })
    await b.save()

    res.json(b)
  } catch (e) { next(e) }
}
