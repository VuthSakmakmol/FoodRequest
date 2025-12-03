// backend/models/leave/LeaveRequest.js
const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const LeaveRequestSchema = new mongoose.Schema({
  // Who is taking leave
  employeeId: {
    type: String,
    required: true,
    trim: true,
  },

  // Who submitted (User.loginId)
  requesterLoginId: {
    type: String,
    required: true,
    trim: true,
  },

  // Type code: AL, SL, UPL, ...
  leaveTypeCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  },

  startDate: {
    type: String, // YYYY-MM-DD
    required: true,
  },
  endDate: {
    type: String, // YYYY-MM-DD
    required: true,
  },

  totalDays: {
    type: Number,
    required: true,
    min: 0.5,
  },

  reason: {
    type: String,
    default: '',
    trim: true,
  },

  status: {
    type: String,
    enum: STATUS,
    default: 'PENDING_MANAGER',
  },

  // Approver mapping
  managerLoginId: {
    type: String,
    default: '',
    trim: true,
  },
  gmLoginId: {
    type: String,
    default: '',
    trim: true,
  },

  // Manager decision
  managerComment: { type: String, default: '' },
  managerDecisionAt: { type: Date },

  // GM decision
  gmComment: { type: String, default: '' },
  gmDecisionAt: { type: Date },

  // For future: soft delete, etc.
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: String, default: '' },
}, { timestamps: true })

LeaveRequestSchema.index({ employeeId: 1, startDate: 1 })
LeaveRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
LeaveRequestSchema.index({ managerLoginId: 1, status: 1 })
LeaveRequestSchema.index({ gmLoginId: 1, status: 1 })

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
