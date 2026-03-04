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
function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => up(x)).filter(Boolean))]
}

/* ───────────────── enums ───────────────── */
// ✅ UPDATED: include COO_ONLY + keep cooLoginId for viewer restriction
const APPROVAL_MODES = Object.freeze([
  'MANAGER_AND_GM',
  'MANAGER_AND_COO',
  'GM_AND_COO',
  'MANAGER_ONLY',
  'GM_ONLY',
  'COO_ONLY',
])

const STATUSES = Object.freeze([
  'PENDING_MANAGER',
  'PENDING_GM',
  'PENDING_COO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

const FORGOT_TYPES = Object.freeze(['FORGET_IN', 'FORGET_OUT'])
const FORGOT_KEYS = Object.freeze(['FORGET_IN', 'FORGET_OUT', 'FORGET_IN_OUT'])

const APPROVAL_LEVELS = Object.freeze(['MANAGER', 'GM', 'COO'])
const APPROVAL_ITEM_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED'])

/* ───────────────── sub-schemas ───────────────── */
const ApprovalItemSchema = new mongoose.Schema(
  {
    level: { type: String, enum: APPROVAL_LEVELS, required: true },
    loginId: { type: String, required: true, default: '' },
    status: { type: String, enum: APPROVAL_ITEM_STATUSES, default: 'PENDING' },
    actedAt: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
)

/* ───────────────── normalization helpers ───────────────── */
function buildForgotKey(forgotTypes = []) {
  const arr = uniqUpper(forgotTypes).filter((x) => FORGOT_TYPES.includes(x))
  const hasIn = arr.includes('FORGET_IN')
  const hasOut = arr.includes('FORGET_OUT')
  if (hasIn && hasOut) return 'FORGET_IN_OUT'
  if (hasIn) return 'FORGET_IN'
  if (hasOut) return 'FORGET_OUT'
  return '' // invalid
}

function normalizeMode(v) {
  const raw = up(v)
  if (APPROVAL_MODES.includes(raw)) return raw
  return 'MANAGER_AND_GM'
}

/**
 * ✅ Auto-clear unused approvers:
 * - We KEEP cooLoginId for MANAGER_ONLY + GM_ONLY because you require:
 *   "COO inbox viewerModes restricted to same cooLoginId".
 *   That means those requests MUST still store cooLoginId.
 */
function modeInvolvesManager(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
}
function modeInvolvesGm(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY'
}
function modeInvolvesCoo(mode) {
  return (
    mode === 'MANAGER_AND_COO' ||
    mode === 'GM_AND_COO' ||
    mode === 'COO_ONLY' ||
    mode === 'GM_ONLY' || // keep for viewer restriction
    mode === 'MANAGER_ONLY' // keep for viewer restriction
  )
}

/* ───────────────── main schema ───────────────── */
const ExpatForgetScanRequestSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, index: true },
    requesterLoginId: { type: String, required: true, index: true },

    // YYYY-MM-DD
    forgotDate: { type: String, required: true, index: true },

    /**
     * ✅ store multiple types in ONE request:
     * - [FORGET_IN]
     * - [FORGET_OUT]
     * - [FORGET_IN, FORGET_OUT]
     */
    forgotTypes: {
      type: [String],
      enum: FORGOT_TYPES,
      default: [],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length >= 1 && v.length <= 2
        },
        message: 'forgotTypes must contain 1 or 2 items.',
      },
    },

    /**
     * ✅ derived key for indexing + duplicate protection
     * - FORGET_IN
     * - FORGET_OUT
     * - FORGET_IN_OUT
     */
    forgotKey: { type: String, enum: FORGOT_KEYS, required: true, index: true },

    reason: { type: String, default: '' },

    approvalMode: { type: String, enum: APPROVAL_MODES, required: true },

    managerLoginId: { type: String, default: '' },
    gmLoginId: { type: String, default: '' },
    cooLoginId: { type: String, default: '' },

    status: { type: String, enum: STATUSES, required: true, index: true },
    approvals: { type: [ApprovalItemSchema], default: [] },

    managerComment: { type: String, default: '' },
    managerDecisionAt: { type: Date, default: null },

    gmComment: { type: String, default: '' },
    gmDecisionAt: { type: Date, default: null },

    cooComment: { type: String, default: '' },
    cooDecisionAt: { type: Date, default: null },

    rejectedReason: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: '' },
    rejectedLevel: { type: String, default: '' },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },

    // NOTE: attachments handled by GridFS endpoints, keep as empty array if you want
    attachments: { type: Array, default: [] },
  },
  { timestamps: true }
)

/* ───────────────── pre-validate (normalize) ───────────────── */
ExpatForgetScanRequestSchema.pre('validate', function (next) {
  try {
    this.employeeId = s(this.employeeId)
    this.requesterLoginId = s(this.requesterLoginId)

    this.forgotDate = s(this.forgotDate)
    this.reason = s(this.reason)

    // normalize forgotTypes
    if (!Array.isArray(this.forgotTypes)) this.forgotTypes = []
    this.forgotTypes = uniqUpper(this.forgotTypes).filter((x) => FORGOT_TYPES.includes(x))

    const key = buildForgotKey(this.forgotTypes)
    if (!key) return next(new Error('forgotTypes must include FORGET_IN and/or FORGET_OUT.'))
    this.forgotKey = key

    // normalize mode
    this.approvalMode = normalizeMode(this.approvalMode)

    // normalize approver ids
    this.managerLoginId = s(this.managerLoginId)
    this.gmLoginId = s(this.gmLoginId)
    this.cooLoginId = s(this.cooLoginId)

    // auto-clear unused approvers (keep DB clean)
    const mode = this.approvalMode
    if (!modeInvolvesManager(mode)) this.managerLoginId = ''
    if (!modeInvolvesGm(mode)) this.gmLoginId = ''
    if (!modeInvolvesCoo(mode)) this.cooLoginId = ''

    // normalize status
    this.status = up(this.status)

    // normalize approvals items
    if (!Array.isArray(this.approvals)) this.approvals = []
    this.approvals = this.approvals.map((a) => ({
      level: up(a?.level),
      loginId: s(a?.loginId),
      status: up(a?.status || 'PENDING'),
      actedAt: a?.actedAt || null,
      note: s(a?.note || ''),
    }))

    // normalize reject fields
    this.rejectedReason = s(this.rejectedReason)
    this.rejectedBy = s(this.rejectedBy)
    this.rejectedLevel = up(this.rejectedLevel)

    this.cancelledBy = s(this.cancelledBy)

    next()
  } catch (e) {
    next(e)
  }
})

/* ───────────────── indexes ─────────────────
   ✅ Prevent duplicates per employee + date + "type set"
   Allows re-submit if previous was REJECTED/CANCELLED.
──────────────────────────────────────────────── */
ExpatForgetScanRequestSchema.index(
  { employeeId: 1, forgotDate: 1, forgotKey: 1 },
  {
    unique: true,
    name: 'uniq_forgetscan_employee_date_key_active',
    partialFilterExpression: {
      status: { $in: ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED'] },
    },
  }
)

ExpatForgetScanRequestSchema.index({ requesterLoginId: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ managerLoginId: 1, status: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ gmLoginId: 1, status: 1, createdAt: -1 })
ExpatForgetScanRequestSchema.index({ cooLoginId: 1, status: 1, createdAt: -1 })

/* ───────────────── statics ───────────────── */
ExpatForgetScanRequestSchema.statics.APPROVAL_MODES = APPROVAL_MODES
ExpatForgetScanRequestSchema.statics.normalizeMode = normalizeMode

module.exports = mongoose.model('ExpatForgetScanRequest', ExpatForgetScanRequestSchema)