/* eslint-disable no-console */
// backend/models/forgetScan/ExpatForgetScanRequest.js

const mongoose = require('mongoose')

/* ───────────────── helpers ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

/* ───────────────── enums ───────────────── */

const APPROVAL_MODES = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])

const STATUSES = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const FORGOT_TYPES = Object.freeze(['FORGET_IN', 'FORGET_OUT'])

const APPROVAL_LEVELS = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_ITEM_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED'])

/* ───────────────── sub-schemas ───────────────── */

const ApprovalItemSchema = new mongoose.Schema(
  {
    level: { type: String, enum: APPROVAL_LEVELS, required: true }, // MANAGER | GM | COO
    loginId: { type: String, required: true, default: '' },
    status: { type: String, enum: APPROVAL_ITEM_STATUSES, default: 'PENDING' },
    actedAt: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
)

/* ───────────────── main schema ───────────────── */

const ExpatForgetScanRequestSchema = new mongoose.Schema(
  {
    // identity
    employeeId: { type: String, required: true, index: true },
    requesterLoginId: { type: String, required: true, index: true },

    // payload
    forgotDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    forgotType: { type: String, enum: FORGOT_TYPES, required: true },
    reason: { type: String, required: true, default: '' },

    // approval routing copied from LeaveProfile at creation time
    approvalMode: { type: String, enum: APPROVAL_MODES, required: true },

    managerLoginId: { type: String, default: '' },
    gmLoginId: { type: String, default: '' },
    cooLoginId: { type: String, default: '' },

    // workflow
    status: { type: String, enum: STATUSES, required: true, index: true },
    approvals: { type: [ApprovalItemSchema], default: [] },

    // decision/audit fields (optional but consistent with LeaveRequest)
    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date, default: null },

    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date, default: null },

    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date, default: null },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },
  },
  { timestamps: true }
)

/* ───────────────── normalization ───────────────── */

// keep data tidy (optional but helpful)
ExpatForgetScanRequestSchema.pre('validate', function (next) {
  try {
    this.employeeId = s(this.employeeId)
    this.requesterLoginId = s(this.requesterLoginId)

    this.forgotDate = s(this.forgotDate)
    this.forgotType = up(this.forgotType)
    this.reason = s(this.reason)

    this.approvalMode = up(this.approvalMode)
    this.managerLoginId = s(this.managerLoginId)
    this.gmLoginId = s(this.gmLoginId)
    this.cooLoginId = s(this.cooLoginId)

    this.status = up(this.status)

    // normalize approvals
    if (!Array.isArray(this.approvals)) this.approvals = []
    this.approvals = this.approvals.map((a) => ({
      level: up(a?.level),
      loginId: s(a?.loginId),
      status: up(a?.status || 'PENDING'),
      actedAt: a?.actedAt || null,
      note: s(a?.note || ''),
    }))

    next()
  } catch (e) {
    next(e)
  }
})

/* ───────────────── indexes ─────────────────
   ✅ Prevent duplicates per employee + date + type,
   but allow re-submit if previous was REJECTED/CANCELLED.
──────────────────────────────────────────────── */

ExpatForgetScanRequestSchema.index(
  { employeeId: 1, forgotDate: 1, forgotType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED'] },
    },
  }
)

// helpful queries
ExpatForgetScanRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ managerLoginId: 1, status: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ gmLoginId: 1, status: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ cooLoginId: 1, status: 1, createdAt: -1 })

module.exports = mongoose.model('ExpatForgetScanRequest', ExpatForgetScanRequestSchema)