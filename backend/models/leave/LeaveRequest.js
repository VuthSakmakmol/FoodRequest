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
  employeeId: { type: String, required: true, trim: true },
  requesterLoginId: { type: String, required: true, trim: true },

  leaveTypeCode: { type: String, required: true, trim: true, uppercase: true },

  startDate: { type: String, required: true }, // YYYY-MM-DD
  endDate: { type: String, required: true },   // YYYY-MM-DD

  totalDays: { type: Number, required: true, min: 0.5 },

  reason: { type: String, default: '', trim: true },

  status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

  managerLoginId: { type: String, default: '', trim: true },
  gmLoginId: { type: String, default: '', trim: true },

  managerComment: { type: String, default: '' },
  managerDecisionAt: { type: Date },

  gmComment: { type: String, default: '' },
  gmDecisionAt: { type: Date },

  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: String, default: '' },
}, { timestamps: true })

LeaveRequestSchema.index({ employeeId: 1, startDate: 1 })
LeaveRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
LeaveRequestSchema.index({ managerLoginId: 1, status: 1 })
LeaveRequestSchema.index({ gmLoginId: 1, status: 1 })

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
