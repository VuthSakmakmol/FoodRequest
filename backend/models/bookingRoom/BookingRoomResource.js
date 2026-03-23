const mongoose = require('mongoose')

function s(v) {
  return String(v ?? '').trim()
}

function toPositiveInt(v, fallback = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.floor(n))
}

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
    imageUrl: {
      type: String,
      default: '',
      trim: true,
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
    this.imageUrl = s(this.imageUrl)
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