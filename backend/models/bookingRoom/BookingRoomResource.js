// backend/models/bookingRoom/BookingRoomResource.js
const mongoose = require('mongoose')

function s(v) {
  return String(v ?? '').trim()
}

function toPositiveInt(v, fallback = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.floor(n))
}

function toBool(v, fallback = true) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return fallback
}

const WeeklyAvailabilitySchema = new mongoose.Schema(
  {
    mon: { type: Boolean, default: true },
    tue: { type: Boolean, default: true },
    wed: { type: Boolean, default: true },
    thu: { type: Boolean, default: true },
    fri: { type: Boolean, default: true },
    sat: { type: Boolean, default: true },
    sun: { type: Boolean, default: true },
  },
  { _id: false }
)

const BookingRoomResourceSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    imageFileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    imageFilename: {
      type: String,
      default: '',
      trim: true,
    },
    imageContentType: {
      type: String,
      default: '',
      trim: true,
    },
    hasImage: {
      type: Boolean,
      default: false,
      index: true,
    },

    weeklyAvailability: {
      type: WeeklyAvailabilitySchema,
      default: () => ({
        mon: true,
        tue: true,
        wed: true,
        thu: true,
        fri: true,
        sat: true,
        sun: true,
      }),
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    collection: 'booking_room_resources',
    timestamps: true,
  }
)

BookingRoomResourceSchema.pre('validate', function (next) {
  try {
    this.code = s(this.code).toUpperCase().replace(/\s+/g, '_')
    this.name = s(this.name)
    this.capacity = toPositiveInt(this.capacity, 1)
    this.imageFilename = s(this.imageFilename)
    this.imageContentType = s(this.imageContentType)
    this.hasImage = !!this.imageFileId

    const wa = this.weeklyAvailability || {}
    this.weeklyAvailability = {
      mon: toBool(wa.mon, true),
      tue: toBool(wa.tue, true),
      wed: toBool(wa.wed, true),
      thu: toBool(wa.thu, true),
      fri: toBool(wa.fri, true),
      sat: toBool(wa.sat, true),
      sun: toBool(wa.sun, true),
    }

    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model(
  'BookingRoomResource',
  BookingRoomResourceSchema,
  'booking_room_resources'
)