// backend/models/CarBooking.js
const mongoose = require('mongoose')

const StopSchema = new mongoose.Schema({
  destination: { type: String, required: true, trim: true },
  destinationOther: { type: String, default: '', trim: true },
  mapLink: { type: String, default: '', trim: true }
}, { _id: false })

const AssignmentSchema = new mongoose.Schema({
  driverId:    { type: String, default: '' },
  driverName:  { type: String, default: '' },
  vehicleId:   { type: String, default: '' },
  vehicleName: { type: String, default: '' },
  notes:       { type: String, default: '' },
  assignedById:   { type: String, default: '' },
  assignedByName: { type: String, default: '' },
  assignedAt:     { type: Date },

  // NEW: driver's own acknowledgment (second step after admin "ACCEPTED")
  driverAck:   { type: String, enum: ['PENDING','ACCEPTED','DECLINED'], default: 'PENDING' },
  driverAckAt: { type: Date }
}, { _id: false })

const CarBookingSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, index: true },
  employee: {
    employeeId: { type: String, required: true },
    name: { type: String, default: '' },
    department: { type: String, default: '' },
    contactNumber: { type: String, default: '' }
  },

  category: { type: String, enum: ['Car','Messenger'], required: true, index: true },
  tripDate: { type: String, required: true, index: true },  // YYYY-MM-DD
  timeStart:{ type: String, required: true },                // HH:MM
  timeEnd:  { type: String, required: true },                // HH:MM

  passengers: { type: Number, default: 1, min: 1 },
  customerContact: { type: String, default: '' },

  stops: {
    type: [StopSchema],
    default: [],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length > 0,
      message: 'At least one destination (stop) is required.'
    }
  },

  purpose: { type: String, default: '' },
  notes: { type: String, default: '' },

  ticketUrl: { type: String, default: '' },

  assignment: { type: AssignmentSchema, default: () => ({}) },

  status: {
    type: String,
    enum: ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED'],
    default: 'PENDING',
    index: true
  },

  createdAt: { type: Date, default: Date.now }
}, { collection: 'car_bookings' })

CarBookingSchema.index({ tripDate: 1, category: 1 })
CarBookingSchema.index({ employeeId: 1, createdAt: -1 })
CarBookingSchema.index({ 'assignment.driverId': 1, tripDate: 1 }) // helpful for driver list

CarBookingSchema.path('stops').validate(function (stops) {
  for (const s of (stops || [])) {
    if (s.destination === 'Other' && !s.destinationOther) return false
  }
  return true
}, 'destinationOther is required when a stop destination is "Other".')

CarBookingSchema.methods.hasAirport = function () {
  return (this.stops || []).some(s => s.destination === 'Airport')
}

module.exports = mongoose.model('CarBooking', CarBookingSchema)
