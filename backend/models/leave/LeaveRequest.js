const mongoose = require('mongoose')

/**
 * ✅ Statuses (same set, flow depends on approvalMode)
 */
const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const DAY_PART = Object.freeze(['AM', 'PM'])

/**
 * ✅ Only 3 approval modes in the whole system
 */
const APPROVAL_MODE = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])

const APPROVAL_LEVEL = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_STATUS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'])

function s(v) {
  return String(v ?? '').trim()
}

function normalizeMode(v) {
  const raw = s(v).toUpperCase()

  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  // legacy
  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_OR_COO') return 'GM_AND_COO'
  if (raw === 'GM_COO') return 'GM_AND_COO'
  if (raw === 'COO_AND_GM') return 'GM_AND_COO'
  if (raw === 'GM_THEN_COO') return 'GM_AND_COO'

  return 'MANAGER_AND_GM'
}

function normalizeStatusForMode(mode, status) {
  const m = normalizeMode(mode)
  const st = s(status).toUpperCase()

  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) return st

  if (m === 'GM_AND_COO') {
    if (st === 'PENDING_MANAGER') return 'PENDING_GM'
    if (st === 'PENDING_GM' || st === 'PENDING_COO') return st
    return 'PENDING_GM'
  }

  if (m === 'MANAGER_AND_GM') {
    if (st === 'PENDING_GM' || st === 'PENDING_MANAGER') return st
    if (st === 'PENDING_COO') return 'PENDING_GM'
    return 'PENDING_MANAGER'
  }

  if (m === 'MANAGER_AND_COO') {
    if (st === 'PENDING_COO' || st === 'PENDING_MANAGER') return st
    if (st === 'PENDING_GM') return 'PENDING_MANAGER'
    return 'PENDING_MANAGER'
  }

  return 'PENDING_MANAGER'
}

function defaultStatusForMode(mode) {
  const m = normalizeMode(mode)
  return m === 'GM_AND_COO' ? 'PENDING_GM' : 'PENDING_MANAGER'
}

/* ─────────────────────────────────────────────
   Approval Step Schema
───────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   NEW: Attachment Schema (Optional Evidence)
───────────────────────────────────────────── */

const AttachmentSchema = new mongoose.Schema(
  {
    attId: { type: String, required: true }, // stable ID for frontend

    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },

    filename: { type: String, default: '' },
    contentType: { type: String, default: '' },
    size: { type: Number, default: 0 },

    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: String, default: '' }, // loginId
    note: { type: String, default: '', trim: true },
  },
  { _id: false }
)

/* ─────────────────────────────────────────────
   Leave Request Schema
───────────────────────────────────────────── */

const LeaveRequestSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    requesterLoginId: { type: String, required: true, trim: true },

    leaveTypeCode: { type: String, required: true, trim: true, uppercase: true },

    startDate: { type: String, required: true },
    endDate: { type: String, required: true },

    startHalf: { type: String, enum: DAY_PART, default: null },
    endHalf: { type: String, enum: DAY_PART, default: null },

    isHalfDay: { type: Boolean, default: false },
    dayPart: { type: String, enum: DAY_PART, default: null },

    totalDays: { type: Number, required: true, min: 0.5 },

    reason: { type: String, default: '', trim: true },

    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'MANAGER_AND_GM' },
    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    managerLoginId: { type: String, default: '', trim: true },
    gmLoginId: { type: String, default: '', trim: true },
    cooLoginId: { type: String, default: '', trim: true },

    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date, default: null },

    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date, default: null },

    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date, default: null },

    approvals: { type: [ApprovalStepSchema], default: [] },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },

    /* ✅ NEW OPTIONAL EVIDENCE FILES */
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
)

/* ─────────────────────────────────────────────
   Safe Normalization Hook
───────────────────────────────────────────── */

LeaveRequestSchema.pre('validate', function (next) {
  try {
    if (this.dayPart === '') this.dayPart = null
    if (this.startHalf === '') this.startHalf = null
    if (this.endHalf === '') this.endHalf = null

    if (this.managerLoginId === null) this.managerLoginId = ''
    if (this.gmLoginId === null) this.gmLoginId = ''
    if (this.cooLoginId === null) this.cooLoginId = ''

    this.approvalMode = normalizeMode(this.approvalMode)

    if (!s(this.status)) {
      this.status = defaultStatusForMode(this.approvalMode)
    }

    this.status = normalizeStatusForMode(this.approvalMode, this.status)

    if (this.isHalfDay) {
      if (!this.startHalf && this.dayPart) this.startHalf = this.dayPart
      if (this.endHalf) this.endHalf = null

      if (this.startDate && this.endDate && this.startDate !== this.endDate) {
        this.endDate = this.startDate
      }

      if (!Number.isFinite(Number(this.totalDays)) || Number(this.totalDays) <= 0) {
        this.totalDays = 0.5
      }

      if (!this.dayPart && this.startHalf) this.dayPart = this.startHalf
      if (!this.dayPart) this.invalidate('dayPart', 'dayPart is required for half-day')
    } else {
      this.dayPart = null
    }

    next()
  } catch (e) {
    next(e)
  }
})

/* ─────────────────────────────────────────────
   Indexes
───────────────────────────────────────────── */

LeaveRequestSchema.index({ employeeId: 1, startDate: 1 })
LeaveRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
LeaveRequestSchema.index({ managerLoginId: 1, status: 1 })
LeaveRequestSchema.index({ gmLoginId: 1, status: 1 })
LeaveRequestSchema.index({ cooLoginId: 1, status: 1 })

LeaveRequestSchema.statics.STATUS = STATUS
LeaveRequestSchema.statics.APPROVAL_MODE = APPROVAL_MODE
LeaveRequestSchema.statics.normalizeMode = normalizeMode

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)