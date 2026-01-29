// backend/models/leave/LeaveRequest.js
const mongoose = require('mongoose')

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',     // ✅ needed for GM_AND_COO flow
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])

// ✅ Only 2 modes forever
const APPROVAL_MODE = Object.freeze(['MANAGER_AND_GM', 'GM_AND_COO'])

// (optional future-proof) approvals array
const APPROVAL_LEVEL = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_STATUS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'])

function s(v) {
  return String(v ?? '').trim()
}

function normalizeApprovalMode(v) {
  const x = String(v ?? '').trim().toUpperCase()
  if (x === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (x === 'MANAGER_GM') return 'MANAGER_AND_GM'
  if (x === 'GM_OR_COO') return 'GM_AND_COO'
  if (x === 'GM_COO') return 'GM_AND_COO'
  return x
}

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

    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    // ✅ flow snapshot at request time (ONLY 2)
    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'MANAGER_AND_GM' },

    // ✅ Approvers snapshot
    managerLoginId: { type: String, default: '', trim: true }, // required only for MANAGER_AND_GM
    gmLoginId: { type: String, default: '', trim: true },      // required for both modes
    cooLoginId: { type: String, default: '', trim: true },     // required only for GM_AND_COO

    // ✅ decisions
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

// ✅ Prevent enum error when frontend sends dayPart: ""
LeaveRequestSchema.pre('validate', function (next) {
  try {
    // normalize empty string -> null
    if (this.dayPart === '') this.dayPart = null

    // normalize approver ids
    this.managerLoginId = s(this.managerLoginId)
    this.gmLoginId = s(this.gmLoginId)
    this.cooLoginId = s(this.cooLoginId)

    // normalize mode (backward compat)
    this.approvalMode = normalizeApprovalMode(this.approvalMode) || 'MANAGER_AND_GM'

    // half-day logic
    if (!this.isHalfDay) {
      this.dayPart = null
    } else {
      this.endDate = this.startDate
      this.totalDays = 0.5
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    }

    // ✅ required approvers by mode
    if (this.approvalMode === 'MANAGER_AND_GM') {
      if (!this.managerLoginId) this.invalidate('managerLoginId', 'managerLoginId is required when approvalMode = MANAGER_AND_GM')
      if (!this.gmLoginId) this.invalidate('gmLoginId', 'gmLoginId is required when approvalMode = MANAGER_AND_GM')
    }

    if (this.approvalMode === 'GM_AND_COO') {
      if (!this.gmLoginId) this.invalidate('gmLoginId', 'gmLoginId is required when approvalMode = GM_AND_COO')
      if (!this.cooLoginId) this.invalidate('cooLoginId', 'cooLoginId is required when approvalMode = GM_AND_COO')
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
