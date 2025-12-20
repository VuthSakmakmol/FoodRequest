// backend/models/leave/LeaveRequest.js
const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])

const LeaveRequestSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    requesterLoginId: { type: String, required: true, trim: true },

    leaveTypeCode: { type: String, required: true, trim: true, uppercase: true },

    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true },   // YYYY-MM-DD

    // ✅ Half-day
    isHalfDay: { type: Boolean, default: false },
    dayPart: { type: String, enum: DAY_PART, default: null }, // null | AM | PM

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
  },
  { timestamps: true }
)

// ✅ Prevent enum error when frontend sends dayPart: ""
LeaveRequestSchema.pre('validate', function (next) {
  try {
    // normalize empty string -> null
    if (this.dayPart === '') this.dayPart = null

    if (!this.isHalfDay) {
      // full-day: dayPart must be null
      this.dayPart = null
    } else {
      // half-day: same day, 0.5, require dayPart
      this.endDate = this.startDate
      this.totalDays = 0.5
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    }
    next()
  } catch (e) {
    next(e)
  }
})

LeaveRequestSchema.index({ employeeId: 1, startDate: 1 })
LeaveRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
LeaveRequestSchema.index({ managerLoginId: 1, status: 1 })
LeaveRequestSchema.index({ gmLoginId: 1, status: 1 })

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
