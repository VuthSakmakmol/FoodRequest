// backend/models/leave/LeaveRequest.js
const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])
const APPROVAL_MODE = Object.freeze(['GM_ONLY', 'GM_OR_COO'])

const APPROVAL_LEVEL = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_STATUS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'])

const ApprovalStepSchema = new mongoose.Schema(
  {
    level: { type: String, enum: APPROVAL_LEVEL, required: true },
    loginId: { type: String, required: true, trim: true },
    status: { type: String, enum: APPROVAL_STATUS, default: 'PENDING' },
    actedAt: { type: Date, default: null },
    note: { type: String, default: '', trim: true },
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

    /**
     * ✅ NEW: Half-day edges (works for multi-day)
     * - startHalf: null | 'AM' | 'PM'
     * - endHalf: null | 'AM' | 'PM'
     */
    startHalf: { type: String, enum: DAY_PART, default: null },
    endHalf: { type: String, enum: DAY_PART, default: null },

    /**
     * ✅ Legacy (keep for old UI / old data)
     * If isHalfDay=true => single-day half with dayPart
     */
    isHalfDay: { type: Boolean, default: false },
    dayPart: { type: String, enum: DAY_PART, default: null }, // null | AM | PM

    totalDays: { type: Number, required: true, min: 0.5 },

    reason: { type: String, default: '', trim: true },

    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'GM_ONLY' },

    managerLoginId: { type: String, default: '', trim: true },
    gmLoginId: { type: String, default: '', trim: true },
    cooLoginId: { type: String, default: '', trim: true },

    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date },

    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date },

    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date },

    approvals: { type: [ApprovalStepSchema], default: [] },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },
  },
  { timestamps: true }
)

// ✅ Keep hook “safe”: normalize only (do NOT compute business totals here)
LeaveRequestSchema.pre('validate', function (next) {
  try {
    // normalize empty string -> null for enums
    if (this.dayPart === '') this.dayPart = null
    if (this.startHalf === '') this.startHalf = null
    if (this.endHalf === '') this.endHalf = null

    // normalize approver ids
    if (this.managerLoginId === null) this.managerLoginId = ''
    if (this.gmLoginId === null) this.gmLoginId = ''
    if (this.cooLoginId === null) this.cooLoginId = ''

    // ✅ Legacy compatibility:
    // If old UI sends isHalfDay/dayPart but not startHalf/endHalf, map it.
    if (this.isHalfDay) {
      if (!this.startHalf && this.dayPart) this.startHalf = this.dayPart
      if (this.endHalf) this.endHalf = null

      // legacy half-day means single-day leave
      if (this.startDate && this.endDate && this.startDate !== this.endDate) {
        this.endDate = this.startDate
      }

      // if totalDays missing/invalid, set minimal legacy value
      if (!Number.isFinite(Number(this.totalDays)) || Number(this.totalDays) <= 0) {
        this.totalDays = 0.5
      }

      if (!this.dayPart && this.startHalf) this.dayPart = this.startHalf
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    } else {
      // if not legacy half, keep dayPart null (legacy field)
      this.dayPart = null
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
