// backend/models/bookingRoom/BookingRoomMaterial.js
const mongoose = require('mongoose')

function s(v) {
  return String(v ?? '').trim()
}

const BookingRoomMaterialSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    name: { type: String, required: true, trim: true, unique: true },
    totalQty: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    collection: 'booking_room_materials',
    timestamps: true,
  }
)

BookingRoomMaterialSchema.pre('validate', function (next) {
  try {
    this.code = s(this.code).toUpperCase().replace(/\s+/g, '_')
    this.name = s(this.name)
    this.totalQty = Math.max(0, Number(this.totalQty || 0))
    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model('BookingRoomMaterial', BookingRoomMaterialSchema, 'booking_room_materials')