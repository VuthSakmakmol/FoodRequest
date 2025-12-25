const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',     // ✅ new
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])
const APPROVAL_MODE = Object.freeze(['GM_ONLY', 'GM_AND_COO'])

// (optional future-proof) approvals array
const APPROVAL_LEVEL = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_STATUS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'])

const ApprovalStepSchema = new mongoose.Schema(
  {
    level:   { type: String, enum: APPROVAL_LEVEL, required: true },
    loginId: { type: String, required: true, trim: true },
    status:  { type: String, enum: APPROVAL_STATUS, default: 'PENDING' },
    actedAt: { type: Date, default: null },
    note:    { type: String, default: '', trim: true },
  },
  { _id: false }
)

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

    // ✅ status supports COO step
    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    // ✅ store flow config snapshot at request time (important if profile changes later)
    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'GM_ONLY' },

    // ✅ Approvers snapshot
    managerLoginId: { type: String, default: '', trim: true }, // optional
    gmLoginId: { type: String, default: '', trim: true },      // required for both modes
    cooLoginId: { type: String, default: '', trim: true },     // required only for GM_AND_COO (or read-only if GM_ONLY)

    // ✅ Manager decision
    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date },

    // ✅ GM decision
    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date },

    // ✅ COO decision (new)
    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date },

    // ✅ optional future-proof approvals array (recommended)
    approvals: { type: [ApprovalStepSchema], default: [] },

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

    // normalize approver ids
    if (this.managerLoginId === null) this.managerLoginId = ''
    if (this.gmLoginId === null) this.gmLoginId = ''
    if (this.cooLoginId === null) this.cooLoginId = ''

    // half-day logic
    if (!this.isHalfDay) {
      // full-day: dayPart must be null
      this.dayPart = null
    } else {
      // half-day: same day, 0.5, require dayPart
      this.endDate = this.startDate
      this.totalDays = 0.5
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    }

    // basic safety: if mode says GM_AND_COO, cooLoginId should exist
    if (this.approvalMode === 'GM_AND_COO' && !String(this.cooLoginId || '').trim()) {
      this.invalidate('cooLoginId', 'cooLoginId is required when approvalMode = GM_AND_COO')
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
LeaveRequestSchema.index({ cooLoginId: 1, status: 1 }) // ✅ new

LeaveRequestSchema.statics.STATUS = STATUS
LeaveRequestSchema.statics.APPROVAL_MODE = APPROVAL_MODE

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
