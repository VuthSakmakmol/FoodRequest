// backend/models/CarBooking.js
const mongoose = require('mongoose')

/* ───────── Enums ───────── */
const BOOKING_TYPES  = Object.freeze(['CAR', 'MESSENGER'])
const BOOKING_STATUS = Object.freeze([
  'NEW',        // created by requester
  'ACCEPTED',   // accepted by admin/driver/messenger
  'ON_ROUTE',   // en route / in progress
  'COMPLETED',  // done
  'CANCELED',   // canceled with reason
  'REJECTED'    // rejected by handlers
])

/* ───────── Subdocs ───────── */
const PersonRefSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // optional (employees may not be Users)
    loginId:  { type: String, trim: true },
    name:     { type: String, trim: true },
    role:     { type: String, enum: ['ADMIN','CHEF','DRIVER','MESSENGER'], trim: true },
    employeeId: { type: String, trim: true } // for requester if you store employee directory IDs
  },
  { _id: false }
)

const LocationSchema = new mongoose.Schema(
  {
    label:   { type: String, trim: true }, // e.g., "HQ", "Warehouse A"
    address: { type: String, trim: true },
    lat:     { type: Number, min: -90, max: 90 },
    lng:     { type: Number, min: -180, max: 180 }
  },
  { _id: false }
)

const VehicleSchema = new mongoose.Schema(
  {
    plate:  { type: String, trim: true }, // e.g., “1AA-2345”
    model:  { type: String, trim: true }, // e.g., “Hilux”
    carId:  { type: String, trim: true }  // your internal car registry id (string or ObjectId if you have a Car model)
  },
  { _id: false }
)

const HistorySchema = new mongoose.Schema(
  {
    at:   { type: Date, default: Date.now },
    by:   PersonRefSchema,            // who made the action
    action: { type: String, trim: true }, // e.g., "CREATE","ACCEPT","START","COMPLETE","CANCEL","REJECT","UPDATE"
    note: { type: String, trim: true }
  },
  { _id: false }
)

/* ───────── Main Schema ───────── */
const CarBookingSchema = new mongoose.Schema(
  {
    type:   { type: String, enum: BOOKING_TYPES, required: true }, // CAR | MESSENGER
    status: { type: String, enum: BOOKING_STATUS, default: 'NEW', index: true },

    // Who requested
    requester: {
      type: PersonRefSchema,
      required: true
    },

    // When
    requestedAt: { type: Date, default: Date.now },
    pickupTime:  { type: Date }, // requested pickup datetime
    returnTime:  { type: Date }, // for CAR returns / expected completion

    // Where
    pickup:  LocationSchema,
    dropoff: LocationSchema,

    // CAR-specific
    passengers: { type: Number, min: 1, default: 1 },  // CAR only (ignored for messenger)
    vehicle:    VehicleSchema,                         // selected or assigned vehicle (optional)

    // MESSENGER-specific
    parcelNote: { type: String, trim: true },         // what to deliver / special instructions

    // Assignment (when accepted)
    assignedTo: PersonRefSchema, // driver or messenger taking the job

    // Admin can set priority
    priority: { type: Number, min: 0, max: 10, default: 0 },

    // Free-form notes
    note:         { type: String, trim: true },
    cancelReason: { type: String, trim: true },

    // Audit trail
    history: { type: [HistorySchema], default: [] }
  },
  { timestamps: true }
)

/* ───────── Indexes ───────── */
CarBookingSchema.index({ type: 1, status: 1, pickupTime: 1 })
CarBookingSchema.index({ 'requester.employeeId': 1, createdAt: -1 })
CarBookingSchema.index({ 'assignedTo.loginId': 1, status: 1 })

/* ───────── Status machine ───────── */
const ALLOWED_TRANSITIONS = {
  NEW:        ['ACCEPTED', 'CANCELED', 'REJECTED'],
  ACCEPTED:   ['ON_ROUTE', 'CANCELED'],
  ON_ROUTE:   ['COMPLETED', 'CANCELED'],
  COMPLETED:  [],
  CANCELED:   [],
  REJECTED:   []
}

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to)
}

/* ───────── Helpers: push history ───────── */
function pushHistory(doc, by, action, note) {
  doc.history.push({
    at: new Date(),
    by: by ? {
      userId: by.userId || by._id || undefined,
      loginId: by.loginId || undefined,
      name: by.name || undefined,
      role: by.role || undefined,
      employeeId: by.employeeId || undefined
    } : undefined,
    action,
    note
  })
}

/* ───────── Type-specific validation ───────── */
CarBookingSchema.pre('save', function (next) {
  if (this.type === 'CAR') {
    // For CAR, passengers >=1; parcelNote not required
    if (!this.passengers || this.passengers < 1) this.passengers = 1
  }
  if (this.type === 'MESSENGER') {
    // For MESSENGER, passengers not relevant
    if (this.passengers == null) this.passengers = undefined
  }
  next()
})

/* ───────── Instance methods (actions) ───────── */
CarBookingSchema.methods.accept = async function(by, opts = {}) {
  if (!canTransition(this.status, 'ACCEPTED')) throw new Error(`Cannot accept from ${this.status}`)
  // Assign handler (driver/messenger/admin assignment)
  if (opts.assignedTo) {
    this.assignedTo = {
      userId: opts.assignedTo.userId || opts.assignedTo._id,
      loginId: opts.assignedTo.loginId,
      name: opts.assignedTo.name,
      role: opts.assignedTo.role
    }
  }
  this.status = 'ACCEPTED'
  pushHistory(this, by, 'ACCEPT', opts.note)
  return this.save()
}

CarBookingSchema.methods.start = async function(by, note) {
  if (!canTransition(this.status, 'ON_ROUTE')) throw new Error(`Cannot start from ${this.status}`)
  this.status = 'ON_ROUTE'
  pushHistory(this, by, 'START', note)
  return this.save()
}

CarBookingSchema.methods.complete = async function(by, note) {
  if (!canTransition(this.status, 'COMPLETED')) throw new Error(`Cannot complete from ${this.status}`)
  this.status = 'COMPLETED'
  pushHistory(this, by, 'COMPLETE', note)
  return this.save()
}

CarBookingSchema.methods.cancel = async function(by, reason) {
  // cancel allowed from NEW/ACCEPTED/ON_ROUTE
  if (!canTransition(this.status, 'CANCELED')) throw new Error(`Cannot cancel from ${this.status}`)
  this.status = 'CANCELED'
  if (reason) this.cancelReason = reason
  pushHistory(this, by, 'CANCEL', reason)
  return this.save()
}

CarBookingSchema.methods.reject = async function(by, reason) {
  if (!canTransition(this.status, 'REJECTED')) throw new Error(`Cannot reject from ${this.status}`)
  this.status = 'REJECTED'
  pushHistory(this, by, 'REJECT', reason)
  return this.save()
}

/* ───────── Statics & exports ───────── */
CarBookingSchema.statics.BOOKING_TYPES  = BOOKING_TYPES
CarBookingSchema.statics.BOOKING_STATUS = BOOKING_STATUS
CarBookingSchema.statics.canTransition  = canTransition

module.exports = mongoose.model('CarBooking', CarBookingSchema)
