// backend/models/bookingRoom/BookingRoomResource.js
const mongoose = require('mongoose')

function s(v) {
  return String(v ?? '').trim()
}

const BookingRoomResourceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    name: { type: String, required: true, trim: true, unique: true },
    isActive: { type: Boolean, default: true, index: true },
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
    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model('BookingRoomResource', BookingRoomResourceSchema, 'booking_room_resources')