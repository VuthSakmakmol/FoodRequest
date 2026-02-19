// backend/models/leave/SwapWorkingDayRequest.js
const mongoose = require('mongoose')

/**
 * Swap Working Day Request
 *
 * User inputs:
 *  - requestDate range: (date-to-date)  ✅ the day(s) employee will WORK (swap-in)
 *  - offDate range:     (date-to-date)  ✅ the compensatory day(s) OFF (swap-out)
 *  - reason
 *  - attachments (GridFS)
 *
 * Approval flow (same semantic modes as LeaveRequest):
 *  - MANAGER_AND_GM   : PENDING_MANAGER -> PENDING_GM  -> APPROVED
 *  - MANAGER_AND_COO  : PENDING_MANAGER -> PENDING_COO -> APPROVED
 *  - GM_AND_COO       : PENDING_GM      -> PENDING_COO -> APPROVED
 *
 * NOTE:
 * - NO "SKIPPED" anywhere (only PENDING/APPROVED/REJECTED)
 */

const STATUS = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const APPROVAL_MODE = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])
const APPROVAL_LEVEL = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_STATUS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED'])

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}

function normalizeMode(v) {
  const raw = up(v)

  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  // legacy compatibility (optional)
  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_COO') return 'GM_AND_COO'
  if (raw === 'GM_OR_COO') return 'GM_AND_COO'
  if (raw === 'COO_AND_GM') return 'GM_AND_COO'
  if (raw === 'GM_THEN_COO') return 'GM_AND_COO'

  return 'MANAGER_AND_GM'
}

function normalizeStatusForMode(mode, status) {
  const m = normalizeMode(mode)
  const st = up(status)

  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) return st

  if (m === 'GM_AND_COO') {
    // manager is not part of this mode, so pending must start at GM
    if (st === 'PENDING_MANAGER') return 'PENDING_GM'
    if (st === 'PENDING_GM' || st === 'PENDING_COO') return st
    return 'PENDING_GM'
  }

  if (m === 'MANAGER_AND_GM') {
    if (st === 'PENDING_MANAGER' || st === 'PENDING_GM') return st
    if (st === 'PENDING_COO') return 'PENDING_GM'
    return 'PENDING_MANAGER'
  }

  if (m === 'MANAGER_AND_COO') {
    if (st === 'PENDING_MANAGER' || st === 'PENDING_COO') return st
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
   Approval Step Schema (NO SKIPPED)
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
   Attachment Schema (GridFS)
───────────────────────────────────────────── */
const AttachmentSchema = new mongoose.Schema(
  {
    attId: { type: String, required: true }, // stable frontend id

    fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // GridFS ObjectId
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
   Main Schema
───────────────────────────────────────────── */
const SwapWorkingDayRequestSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    requesterLoginId: { type: String, required: true, trim: true },

    // ✅ swap-in: employee will WORK these day(s)
    requestStartDate: { type: String, required: true }, // YYYY-MM-DD
    requestEndDate: { type: String, required: true }, // YYYY-MM-DD

    // ✅ swap-out: employee will take OFF these day(s)
    offStartDate: { type: String, required: true }, // YYYY-MM-DD
    offEndDate: { type: String, required: true }, // YYYY-MM-DD

    // (Optional but useful for UI/reporting)
    requestTotalDays: { type: Number, default: 0 },
    offTotalDays: { type: Number, default: 0 },

    reason: { type: String, default: '', trim: true },

    // approvals
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

    // evidence
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
)

/* ─────────────────────────────────────────────
   Pre-validate normalization
───────────────────────────────────────────── */
SwapWorkingDayRequestSchema.pre('validate', function (next) {
  try {
    // normalize strings
    this.employeeId = s(this.employeeId)
    this.requesterLoginId = s(this.requesterLoginId)

    this.requestStartDate = s(this.requestStartDate)
    this.requestEndDate = s(this.requestEndDate)
    this.offStartDate = s(this.offStartDate)
    this.offEndDate = s(this.offEndDate)

    this.managerLoginId = s(this.managerLoginId || '')
    this.gmLoginId = s(this.gmLoginId || '')
    this.cooLoginId = s(this.cooLoginId || '')

    // normalize mode + status
    this.approvalMode = normalizeMode(this.approvalMode)
    if (!s(this.status)) this.status = defaultStatusForMode(this.approvalMode)
    this.status = normalizeStatusForMode(this.approvalMode, this.status)

    // basic date format validation (range validation will be done in controller/service)
    if (!isValidYMD(this.requestStartDate)) this.invalidate('requestStartDate', 'requestStartDate must be YYYY-MM-DD')
    if (!isValidYMD(this.requestEndDate)) this.invalidate('requestEndDate', 'requestEndDate must be YYYY-MM-DD')
    if (!isValidYMD(this.offStartDate)) this.invalidate('offStartDate', 'offStartDate must be YYYY-MM-DD')
    if (!isValidYMD(this.offEndDate)) this.invalidate('offEndDate', 'offEndDate must be YYYY-MM-DD')

    next()
  } catch (e) {
    next(e)
  }
})

/* ─────────────────────────────────────────────
   Indexes
───────────────────────────────────────────── */
SwapWorkingDayRequestSchema.index({ employeeId: 1, createdAt: -1 })
SwapWorkingDayRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })

SwapWorkingDayRequestSchema.index({ managerLoginId: 1, status: 1 })
SwapWorkingDayRequestSchema.index({ gmLoginId: 1, status: 1 })
SwapWorkingDayRequestSchema.index({ cooLoginId: 1, status: 1 })

// helpful for reporting filters
SwapWorkingDayRequestSchema.index({ employeeId: 1, requestStartDate: 1 })
SwapWorkingDayRequestSchema.index({ employeeId: 1, offStartDate: 1 })

/* ─────────────────────────────────────────────
   Statics
───────────────────────────────────────────── */
SwapWorkingDayRequestSchema.statics.STATUS = STATUS
SwapWorkingDayRequestSchema.statics.APPROVAL_MODE = APPROVAL_MODE
SwapWorkingDayRequestSchema.statics.normalizeMode = normalizeMode

module.exports = mongoose.model('SwapWorkingDayRequest', SwapWorkingDayRequestSchema)