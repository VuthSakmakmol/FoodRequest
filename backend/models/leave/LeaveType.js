// backend/models/leave/LeaveType.js
const mongoose = require('mongoose')

const LeaveTypeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  requiresBalance: {
    type: Boolean,
    default: true, // e.g. ANNUAL needs balance, UNPAID might not
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  },
}, { timestamps: true })

LeaveTypeSchema.index({ code: 1 })

module.exports = mongoose.model('LeaveType', LeaveTypeSchema)
