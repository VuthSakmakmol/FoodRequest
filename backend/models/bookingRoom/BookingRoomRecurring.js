// backend/models/bookingRoom/BookingRoomRecurring.js
const mongoose = require('mongoose')

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

const RECURRING_STATUS = [
  'PENDING',
  'PARTIAL_APPROVED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]

const RECURRING_FREQUENCY = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

const EmployeeSnapshotSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    position: { type: String, default: '', trim: true },
    contactNumber: { type: String, default: '', trim: true },
  },
  { _id: false }
)

const RequestedRoomSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomResource',
    },
    roomCode: { type: String, default: '', trim: true, uppercase: true },
    roomName: { type: String, default: '', trim: true },
  },
  { _id: false }
)

const RequestedMaterialSchema = new mongoose.Schema(
  {
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomMaterial',
    },
    materialCode: { type: String, required: true, trim: true, uppercase: true },
    materialName: { type: String, default: '', trim: true },
    qty: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false }
)

const RecurrenceRuleSchema = new mongoose.Schema(
  {
    frequency: {
      type: String,
      enum: RECURRING_FREQUENCY,
      default: 'WEEKLY',
      required: true,
    },

    interval: {
      type: Number,
      default: 1,
      min: 1,
    },

    byWeekDays: {
      type: [String], // MON TUE WED THU FRI SAT SUN
      default: [],
    },

    startDate: {
      type: String,
      required: true,
      trim: true,
    },

    endDate: {
      type: String,
      required: true,
      trim: true,
    },

    skipHoliday: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
)

const BookingRoomRecurringSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true, index: true },
    employee: { type: EmployeeSnapshotSchema, required: true },

    bookingDates: {
      type: [String], // generated dates YYYY-MM-DD
      default: [],
      index: true,
    },

    recurrenceRule: {
      type: RecurrenceRuleSchema,
      required: true,
    },

    timeStart: { type: String, required: true, trim: true },
    timeEnd: { type: String, required: true, trim: true },

    meetingTitle: { type: String, default: '', trim: true },
    purpose: { type: String, default: '', trim: true },
    participantEstimate: { type: Number, default: 1, min: 1 },
    note: { type: String, default: '', trim: true },
    needCoffeeBreak: { type: Boolean, default: false },
    needNameOnTable: { type: Boolean, default: false },
    needWifiPassword: { type: Boolean, default: false },

    roomRequired: { type: Boolean, default: false, index: true },

    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomResource',
      index: true,
    },
    roomCode: { type: String, default: '', trim: true, uppercase: true, index: true },
    roomName: { type: String, default: '', trim: true, index: true },
    room: { type: RequestedRoomSchema, default: null },

    materialRequired: { type: Boolean, default: false, index: true },
    materials: {
      type: [RequestedMaterialSchema],
      default: [],
    },

    childBookingIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'BookingRoom',
      default: [],
    },

    totalOccurrences: { type: Number, default: 0, min: 0 },

    overallStatus: {
      type: String,
      enum: RECURRING_STATUS,
      default: 'PENDING',
      index: true,
    },

    submittedVia: {
      type: String,
      enum: ['PUBLIC_FORM', 'ADMIN_FORM'],
      default: 'PUBLIC_FORM',
    },

    cancelReason: { type: String, default: '', trim: true },

    requesterLoginId: { type: String, default: '', trim: true, index: true },
    createdByLoginId: { type: String, default: '', trim: true, index: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'booking_room_recurring',
  }
)

BookingRoomRecurringSchema.index({ employeeId: 1, createdAt: -1 })
BookingRoomRecurringSchema.index({ overallStatus: 1, createdAt: -1 })
BookingRoomRecurringSchema.index({ roomCode: 1, overallStatus: 1 })
BookingRoomRecurringSchema.index({ bookingDates: 1 })

function normalizeRoomFields(doc) {
  const roomObj = doc.room && typeof doc.room === 'object' ? doc.room : {}

  const roomId = roomObj.roomId || doc.roomId || null
  const roomCode = up(roomObj.roomCode || doc.roomCode)
  const roomName = s(roomObj.roomName || doc.roomName)

  doc.roomId = roomId
  doc.roomCode = roomCode
  doc.roomName = roomName

  if (roomId || roomCode || roomName) {
    doc.room = {
      roomId,
      roomCode,
      roomName,
    }
  } else {
    doc.room = null
  }
}

function normalizeMaterialItems(items) {
  if (!Array.isArray(items)) return []

  const normalized = []
  const map = new Map()

  for (const raw of items) {
    const materialId = raw?.materialId || null
    const materialCode = up(raw?.materialCode)
    const materialName = s(raw?.materialName)
    const qty = Math.max(1, Number(raw?.qty || 1))

    if (!materialCode) continue

    const key = materialCode
    const prev = map.get(key)

    if (prev) {
      prev.qty += qty
      continue
    }

    const item = {
      materialId,
      materialCode,
      materialName,
      qty,
    }

    map.set(key, item)
    normalized.push(item)
  }

  return normalized
}

function normalizeWeekDays(list = []) {
  const allow = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
  return [...new Set((Array.isArray(list) ? list : []).map(up).filter((x) => allow.has(x)))]
}

BookingRoomRecurringSchema.pre('validate', function (next) {
  try {
    this.employeeId = s(this.employeeId)

    if (this.employee && typeof this.employee === 'object') {
      this.employee = {
        employeeId: s(this.employee.employeeId),
        name: s(this.employee.name),
        department: s(this.employee.department),
        position: s(this.employee.position),
        contactNumber: s(this.employee.contactNumber),
      }
    }

    this.bookingDates = Array.isArray(this.bookingDates)
      ? [...new Set(this.bookingDates.map((x) => s(x)).filter(Boolean))].sort()
      : []

    this.timeStart = s(this.timeStart)
    this.timeEnd = s(this.timeEnd)

    this.meetingTitle = s(this.meetingTitle)
    this.purpose = s(this.purpose)
    this.note = s(this.note)

    this.roomRequired = Boolean(this.roomRequired)
    this.materialRequired = Boolean(this.materialRequired)

    this.needCoffeeBreak = !!this.needCoffeeBreak
    this.needNameOnTable = !!this.needNameOnTable
    this.needWifiPassword = !!this.needWifiPassword

    normalizeRoomFields(this)
    this.materials = normalizeMaterialItems(this.materials)

    const rr = this.recurrenceRule || {}
    this.recurrenceRule = {
    frequency: up(rr.frequency || 'WEEKLY'),
    interval: Math.max(1, Number(rr.interval || 1)),
    byWeekDays: normalizeWeekDays(rr.byWeekDays),
    startDate: s(rr.startDate),
    endDate: s(rr.endDate),
    skipHoliday: rr.skipHoliday !== false,
    }

    this.cancelReason = s(this.cancelReason)
    this.requesterLoginId = s(this.requesterLoginId)
    this.createdByLoginId = s(this.createdByLoginId)

    if (!this.bookingDates.length) {
      return next(new Error('bookingDates is required.'))
    }

    if (!this.recurrenceRule.startDate || !this.recurrenceRule.endDate) {
      return next(new Error('recurrenceRule startDate/endDate is required.'))
    }

    if (!this.roomRequired && !this.materialRequired) {
      return next(new Error('At least one of roomRequired or materialRequired must be true.'))
    }

    if (this.roomRequired && !this.roomCode && !this.roomName) {
      return next(new Error('roomCode or roomName is required when roomRequired is true.'))
    }

    if (this.materialRequired && !this.materials.length) {
      return next(new Error('materials is required when materialRequired is true.'))
    }

    this.totalOccurrences = this.bookingDates.length
    this.updatedAt = new Date()

    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model(
  'BookingRoomRecurring',
  BookingRoomRecurringSchema,
  'booking_room_recurring'
)