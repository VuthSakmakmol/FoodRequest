// models/transportation/CarBooking.js
const mongoose = require('mongoose')

/* ───────── Stop Schema ───────── */
const StopSchema = new mongoose.Schema({
  destination: { type: String, required: true, trim: true },
  destinationOther: { type: String, default: '', trim: true },
  mapLink: { type: String, default: '', trim: true }
}, { _id: false })

/* ───────── Assignment Schema ───────── */
const AssignmentSchema = new mongoose.Schema({
  // ── DRIVER ──
  driverId:    { type: String, default: '' },
  driverName:  { type: String, default: '' },
  driverAck:   { type: String, enum: ['PENDING','ACCEPTED','DECLINED'], default: 'PENDING' },
  driverAckAt: { type: Date },

  // ── MESSENGER ──
  messengerId:    { type: String, default: '' },
  messengerName:  { type: String, default: '' },
  messengerAck:   { type: String, enum: ['PENDING','ACCEPTED','DECLINED'], default: 'PENDING' },
  messengerAckAt: { type: Date },

  // ── VEHICLE ──
  vehicleId:   { type: String, default: '' },
  vehicleName: { type: String, default: '' },

  // ── META ──
  notes:          { type: String, default: '' },
  assignedById:   { type: String, default: '' },
  assignedByName: { type: String, default: '' },
  assignedAt:     { type: Date },
}, { _id: false })

/* ───────── Main Booking Schema ───────── */
const CarBookingSchema = new mongoose.Schema({
  seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'TransportationRecurringSeries', default: null },
  idempotencyKey: { type: String, default: undefined },

  employeeId: { type: String, required: true, index: true },
  employee: {
    employeeId: { type: String, required: true },
    name: { type: String, default: '' },
    department: { type: String, default: '' },
    contactNumber: { type: String, default: '' }
  },

  category: { type: String, enum: ['Car','Messenger'], required: true, index: true },
  tripDate: { type: String, required: true, index: true },  // YYYY-MM-DD
  timeStart:{ type: String, required: true },
  timeEnd:  { type: String, required: true },

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
    enum: ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMEBACK','COMPLETED','DELAYED','CANCELLED'],
    default: 'PENDING',
    index: true
  },

  createdAt: { type: Date, default: Date.now }
}, { collection: 'car_bookings' })

/* ───────── Indexes ───────── */
CarBookingSchema.index({ tripDate: 1, category: 1 })
CarBookingSchema.index({ employeeId: 1, createdAt: -1 })
CarBookingSchema.index({ 'assignment.driverId': 1, tripDate: 1 })
CarBookingSchema.index({ 'assignment.messengerId': 1, tripDate: 1 })

// ✅ HARD STOP duplicates for recurring series: only 1 booking per (seriesId + tripDate)
CarBookingSchema.index(
  { seriesId: 1, tripDate: 1 },
  {
    unique: true,
    partialFilterExpression: { seriesId: { $type: 'objectId' } },
  }
)

// ✅ Keep idempotencyKey unique (optional but good)
CarBookingSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true }
)

/* ───────── Validators ───────── */
CarBookingSchema.path('stops').validate(function (stops) {
  for (const s of (stops || [])) {
    if (s.destination === 'Other' && !s.destinationOther) return false
  }
  return true
}, 'destinationOther is required when a stop destination is "Other".')

/* ───────── Methods ───────── */
CarBookingSchema.methods.hasAirport = function () {
  return (this.stops || []).some(
    s => s.destination === 'Techo International Airport'
  )
}

module.exports = mongoose.model('CarBooking', CarBookingSchema, 'car_bookings')
