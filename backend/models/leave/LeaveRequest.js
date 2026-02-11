// backend/models/leave/LeaveRequest.js
const mongoose = require('mongoose')

/**
 * ✅ Statuses (same set, flow depends on approvalMode)
 * - MANAGER_AND_GM  : PENDING_MANAGER -> PENDING_GM -> APPROVED
 * - MANAGER_AND_COO : PENDING_MANAGER -> PENDING_COO -> APPROVED
 * - GM_AND_COO      : PENDING_GM      -> PENDING_COO -> APPROVED   (manager skipped)
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

  // already correct
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  // legacy values seen in older code
  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_OR_COO') return 'GM_AND_COO'
  if (raw === 'GM_COO') return 'GM_AND_COO'
  if (raw === 'COO_AND_GM') return 'GM_AND_COO'
  if (raw === 'GM_THEN_COO') return 'GM_AND_COO'

  // fallback (safest default)
  return 'MANAGER_AND_GM'
}

function normalizeStatusForMode(mode, status) {
  const m = normalizeMode(mode)
  const st = s(status).toUpperCase()

  // keep terminal states always
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) return st

  // ensure a sane starting state per mode
  if (m === 'GM_AND_COO') {
    // manager skipped
    if (st === 'PENDING_MANAGER') return 'PENDING_GM'
    if (st === 'PENDING_GM' || st === 'PENDING_COO') return st
    return 'PENDING_GM'
  }

  // modes that require manager first
  if (m === 'MANAGER_AND_GM') {
    if (st === 'PENDING_GM' || st === 'PENDING_MANAGER') return st
    if (st === 'PENDING_COO') return 'PENDING_GM' // downgrade weird legacy state
    return 'PENDING_MANAGER'
  }

  // MANAGER_AND_COO
  if (m === 'MANAGER_AND_COO') {
    if (st === 'PENDING_COO' || st === 'PENDING_MANAGER') return st
    if (st === 'PENDING_GM') return 'PENDING_MANAGER' // GM not used in this mode
    return 'PENDING_MANAGER'
  }

  return 'PENDING_MANAGER'
}

function defaultStatusForMode(mode) {
  const m = normalizeMode(mode)
  return m === 'GM_AND_COO' ? 'PENDING_GM' : 'PENDING_MANAGER'
}

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
    endDate: { type: String, required: true }, // YYYY-MM-DD

    /**
     * ✅ Half-day edges (works for multi-day)
     */
    startHalf: { type: String, enum: DAY_PART, default: null },
    endHalf: { type: String, enum: DAY_PART, default: null },

    /**
     * ✅ Legacy: single-day half with dayPart
     */
    isHalfDay: { type: Boolean, default: false },
    dayPart: { type: String, enum: DAY_PART, default: null },

    totalDays: { type: Number, required: true, min: 0.5 },

    reason: { type: String, default: '', trim: true },

    /**
     * ✅ Only 3 modes
     */
    approvalMode: { type: String, enum: APPROVAL_MODE, default: 'MANAGER_AND_GM' },

    /**
     * ✅ Status depends on approvalMode
     * We still keep it as a normal field (controller drives transitions),
     * but we normalize it safely in pre-validate.
     */
    status: { type: String, enum: STATUS, default: 'PENDING_MANAGER' },

    // approvers (may be blank depending on mode)
    managerLoginId: { type: String, default: '', trim: true },
    gmLoginId: { type: String, default: '', trim: true },
    cooLoginId: { type: String, default: '', trim: true },

    // legacy fields (still used by many screens)
    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date, default: null },

    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date, default: null },

    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date, default: null },

    approvals: { type: [ApprovalStepSchema], default: [] },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },
  },
  { timestamps: true }
)

/**
 * ✅ Keep hook “safe”: normalize only (do NOT compute business totals here)
 * - normalize enums / legacy fields
 * - normalize approvalMode legacy values to the 3 semantic values
 * - normalize status for the chosen mode (important for GM_AND_COO start state)
 */
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

    // ✅ normalize approvalMode to 3 modes
    this.approvalMode = normalizeMode(this.approvalMode)

    // ✅ ensure default status matches mode when creating new doc
    // (mongoose default already set, but this fixes cases where approvalMode changed)
    if (!s(this.status)) {
      this.status = defaultStatusForMode(this.approvalMode)
    }

    // ✅ normalize non-terminal status to match mode rules
    this.status = normalizeStatusForMode(this.approvalMode, this.status)

    // ✅ Legacy compatibility: map isHalfDay/dayPart into startHalf
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

    // ✅ minimal sanity checks per mode (don’t hard-break old data)
    const mode = this.approvalMode
    if (mode === 'MANAGER_AND_GM') {
      // manager + gm should exist in normal flow (but allow blank for old imports)
    }
    if (mode === 'MANAGER_AND_COO') {
      // coo should exist in normal flow (but allow blank for old imports)
    }
    if (mode === 'GM_AND_COO') {
      // gm + coo should exist in normal flow (but allow blank for old imports)
      // manager is skipped
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
LeaveRequestSchema.statics.normalizeMode = normalizeMode

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema)
