const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',       // ✅ final stage for GM or COO
  // 'PENDING_COO',    // (optional) keep ONLY if you already have old data
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])

// ✅ OR-mode (what you want)
const APPROVAL_MODE = Object.freeze(['GM_ONLY', 'GM_OR_COO'])

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

    // ✅ status: keep final stage as PENDING_GM
    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    // ✅ store flow config snapshot at request time
    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'GM_ONLY' },

    // ✅ Approvers snapshot
    managerLoginId: { type: String, default: '', trim: true }, // optional
    gmLoginId: { type: String, default: '', trim: true },      // required for both modes
    cooLoginId: { type: String, default: '', trim: true },     // required only for GM_OR_COO

    // ✅ Manager decision
    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date },

    // ✅ GM decision
    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date },

    // ✅ COO decision
    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date },

    // ✅ optional future-proof approvals array
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
      this.dayPart = null
    } else {
      this.endDate = this.startDate
      this.totalDays = 0.5
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    }

    // ✅ OR-mode requires cooLoginId
    if (this.approvalMode === 'GM_OR_COO' && !String(this.cooLoginId || '').trim()) {
      this.invalidate('cooLoginId', 'cooLoginId is required when approvalMode = GM_OR_COO')
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
LeaveRequestSchema.index({ cooLoginId: 1, status: 1 })

LeaveRequestSchema.statics.STATUS = STATUS
LeaveRequestSchema.statics.APPROVAL_MODE = APPROVAL_MODE

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
