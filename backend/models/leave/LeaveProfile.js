// backend/models/leave/LeaveProfile.js
const mongoose = require('mongoose')

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

function addDaysYMD(ymd, deltaDays) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addYearsYMD(ymd, years) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function s(v) {
  return String(v ?? '').trim()
}

// ✅ Only 2 modes forever
const APPROVAL_MODE = Object.freeze(['MANAGER_AND_GM', 'GM_AND_COO'])

function normalizeApprovalMode(v) {
  const x = String(v ?? '').trim().toUpperCase()
  if (x === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (x === 'MANAGER_GM') return 'MANAGER_AND_GM'
  if (x === 'GM_OR_COO') return 'GM_AND_COO'
  if (x === 'GM_COO') return 'GM_AND_COO'
  return x
}

const BalanceSchema = new mongoose.Schema(
  {
    leaveTypeCode: { type: String, required: true }, // AL/SP/MC/MA/UL
    yearlyEntitlement: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  },
  { _id: false }
)

const ContractSnapshotSchema = new mongoose.Schema(
  {
    asOf: { type: String, default: '' }, // YYYY-MM-DD
    balances: { type: [BalanceSchema], default: [] },
    contractDate: { type: String, default: '' },
    contractEndDate: { type: String, default: '' },
  },
  { _id: false }
)

const ContractHistorySchema = new mongoose.Schema(
  {
    contractNo: { type: Number, required: true },
    startDate: { type: String, default: '' }, // YYYY-MM-DD
    endDate: { type: String, default: '' },   // YYYY-MM-DD
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    openedBy: { type: String, default: '' },
    closedBy: { type: String, default: '' },
    note: { type: String, default: '' },
    closeSnapshot: { type: ContractSnapshotSchema, default: null },
  },
  { _id: false }
)

const LeaveProfileSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, index: true },
    employeeLoginId: { type: String, default: '' },

    // approver1 (only needed for MANAGER_AND_GM)
    managerLoginId: { type: String, default: '' },

    // approver2 always exists via backend seed
    gmLoginId: { type: String, default: '' },

    // COO exists for GM_AND_COO mode
    cooLoginId: { type: String, default: '' },

    // ✅ approval mode (ONLY 2)
    approvalMode: {
      type: String,
      enum: APPROVAL_MODE,
      default: 'MANAGER_AND_GM',
    },

    name: { type: String, default: '' },
    department: { type: String, default: '' },

    joinDate: { type: String, default: '' },        // YYYY-MM-DD
    contractDate: { type: String, default: '' },    // YYYY-MM-DD
    contractEndDate: { type: String, default: '' }, // auto = start + 1y - 1d

    isActive: { type: Boolean, default: true },

    balances: { type: [BalanceSchema], default: [] },
    balancesAsOf: { type: String, default: '' },

    contracts: { type: [ContractHistorySchema], default: [] },

    contractExpiryNotifiedFor: { type: String, default: '' },
    contractExpiryNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

// auto: if contractDate missing, use joinDate
// auto calc contractEndDate = contractDate + 1 year - 1 day
LeaveProfileSchema.pre('validate', function (next) {
  try {
    // normalize ids
    this.employeeId = s(this.employeeId)
    this.employeeLoginId = s(this.employeeLoginId)
    this.managerLoginId = s(this.managerLoginId)
    this.gmLoginId = s(this.gmLoginId)
    this.cooLoginId = s(this.cooLoginId)

    // normalize mode (backward compat)
    this.approvalMode = normalizeApprovalMode(this.approvalMode) || 'MANAGER_AND_GM'

    // if contractDate missing, use joinDate
    if (!this.contractDate && this.joinDate) this.contractDate = this.joinDate

    if (isValidYMD(this.contractDate)) {
      const end = addDaysYMD(addYearsYMD(this.contractDate, 1), -1)
      this.contractEndDate = end
    }

    // ✅ enforce approver requirement by mode
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

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)
