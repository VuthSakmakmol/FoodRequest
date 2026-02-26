// backend/models/leave/LeaveProfile.js
const mongoose = require('mongoose')

/* ───────────────── helpers ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = s(ymd).split('-').map(Number)
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
function endFromStartYMD(startYMD) {
  if (!isValidYMD(startYMD)) return ''
  // end = start + 1 year - 1 day (UTC safe)
  return addDaysYMD(addYearsYMD(startYMD, 1), -1)
}

/**
 * ✅ Approval modes (semantic)
 */
const APPROVAL_MODE = Object.freeze([
  'MANAGER_AND_GM',
  'MANAGER_AND_COO',
  'GM_AND_COO',
  'MANAGER_ONLY', // ✅ NEW
  'GM_ONLY', // ✅ NEW
])

function normalizeApprovalMode(v) {
  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'MANAGER_ONLY') return 'MANAGER_ONLY' // ✅ NEW
  if (raw === 'GM_ONLY') return 'GM_ONLY' // ✅ NEW
  // safest default
  return 'MANAGER_AND_GM'
}

function modeInvolvesManager(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
}
function modeInvolvesGm(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY'
}
function modeInvolvesCoo(mode) {
  return mode === 'MANAGER_AND_COO' || mode === 'GM_AND_COO'
}

function normalizeCarryObj(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    AL: num(src.AL),
    SP: num(src.SP),
    MC: num(src.MC),
    MA: num(src.MA),
    UL: num(src.UL),
  }
}

/* ───────────────── schemas ───────────────── */

const BalanceSchema = new mongoose.Schema(
  {
    leaveTypeCode: { type: String, required: true }, // AL/SP/MC/MA/UL
    yearlyEntitlement: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  },
  { _id: false }
)

const CarrySchema = new mongoose.Schema(
  {
    AL: { type: Number, default: 0 },
    SP: { type: Number, default: 0 },
    MC: { type: Number, default: 0 },
    MA: { type: Number, default: 0 },
    UL: { type: Number, default: 0 },
  },
  { _id: false }
)

const ContractSnapshotSchema = new mongoose.Schema(
  {
    asOf: { type: String, default: '' }, // YYYY-MM-DD
    contractDate: { type: String, default: '' }, // start
    contractEndDate: { type: String, default: '' }, // end
    carry: { type: CarrySchema, default: () => ({}) },
    balances: { type: [BalanceSchema], default: [] },
  },
  { _id: false }
)

const ContractSchema = new mongoose.Schema(
  {
    contractNo: { type: Number, required: true },

    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true }, // YYYY-MM-DD

    // ✅ Source of truth: per-contract carry
    carry: { type: CarrySchema, default: () => ({}) },

    openedAt: { type: Date, default: Date.now },
    openedBy: { type: String, default: '' },

    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: '' },

    note: { type: String, default: '' },

    // ✅ store balances snapshot (optional but recommended)
    openSnapshot: { type: ContractSnapshotSchema, default: null },
    closeSnapshot: { type: ContractSnapshotSchema, default: null },
  },
  { _id: false }
)

/* ───────────────── main profile ───────────────── */

const LeaveProfileSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, index: true }, // employeeId in EmployeeDirectory
    employeeLoginId: { type: String, required: true, index: true }, // loginId for User account

    // Approvers (by loginId)
    managerLoginId: { type: String, default: '' },
    gmLoginId: { type: String, default: '' },
    cooLoginId: { type: String, default: '' },

    approvalMode: {
      type: String,
      enum: APPROVAL_MODE,
      default: 'MANAGER_AND_GM',
    },

    // Optional denormalized info (UI convenience)
    name: { type: String, default: '' },
    department: { type: String, default: '' },

    joinDate: { type: String, required: true }, // YYYY-MM-DD

    // Current contract pointers (always match latest contract)
    contractDate: { type: String, required: true }, // current start
    contractEndDate: { type: String, required: true }, // current end

    isActive: { type: Boolean, default: true },

    // Current contract computed balances (for UI speed)
    balances: { type: [BalanceSchema], default: [] },
    balancesAsOf: { type: String, default: '' },

    // ✅ Contract history (each contract owns carry + snapshots)
    contracts: { type: [ContractSchema], default: [] },

    // Optional notifications
    contractExpiryNotifiedFor: { type: String, default: '' },
    contractExpiryNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

/* ───────────────── internal helpers ───────────────── */

function sortContractsAsc(list) {
  const arr = Array.isArray(list) ? list.slice() : []
  return arr.sort((a, b) => {
    const sa = s(a?.startDate)
    const sb = s(b?.startDate)
    const va = isValidYMD(sa)
    const vb = isValidYMD(sb)
    if (va && vb) return sa.localeCompare(sb)
    if (va && !vb) return -1
    if (!va && vb) return 1
    return num(a?.contractNo) - num(b?.contractNo)
  })
}

function pickLatestContract(list) {
  const arr = sortContractsAsc(list)
  return arr.length ? arr[arr.length - 1] : null
}

/* ───────────────── pre-validate (NO legacy migration) ─────────────────
   Clean rules:
   - approvalMode normalized
   - contracts must exist
   - contractNo auto-assigned if missing
   - endDate auto-filled from startDate if missing
   - contractDate/contractEndDate pointers always match latest contract
   - ✅ BIG: approver ids auto-cleared based on approvalMode
───────────────────────────────────────────────────────────── */

LeaveProfileSchema.pre('validate', function (next) {
  try {
    // normalize approvalMode
    this.approvalMode = normalizeApprovalMode(this.approvalMode)

    // ✅ normalize approver ids
    this.managerLoginId = s(this.managerLoginId)
    this.gmLoginId = s(this.gmLoginId)
    this.cooLoginId = s(this.cooLoginId)

    // ✅ BIG: auto-clear unused approvers by mode (keeps DB clean)
    const mode = this.approvalMode
    if (!modeInvolvesManager(mode)) this.managerLoginId = ''
    if (!modeInvolvesGm(mode)) this.gmLoginId = ''
    if (!modeInvolvesCoo(mode)) this.cooLoginId = ''

    // normalize required strings
    this.employeeId = s(this.employeeId)
    this.employeeLoginId = s(this.employeeLoginId)
    this.joinDate = s(this.joinDate)

    if (!isValidYMD(this.joinDate)) {
      return next(new Error('joinDate must be YYYY-MM-DD'))
    }

    if (!Array.isArray(this.contracts)) this.contracts = []

    // if empty contracts, create the first contract from contractDate or joinDate
    if (this.contracts.length === 0) {
      const start = isValidYMD(this.contractDate) ? s(this.contractDate) : s(this.joinDate)
      const end = endFromStartYMD(start)

      this.contracts.push({
        contractNo: 1,
        startDate: start,
        endDate: end,
        carry: normalizeCarryObj({}),
        openedAt: new Date(),
        openedBy: 'system',
        note: 'Initial contract',
        openSnapshot: null,
        closeSnapshot: null,
      })
    }

    // normalize all contracts
    const sorted = sortContractsAsc(this.contracts)

    // assign contractNo if missing, based on ascending order
    sorted.forEach((c, idx) => {
      if (!Number.isFinite(Number(c.contractNo)) || Number(c.contractNo) <= 0) {
        c.contractNo = idx + 1
      } else {
        c.contractNo = Number(c.contractNo)
      }

      c.startDate = s(c.startDate)
      if (!isValidYMD(c.startDate)) {
        throw new Error(`contracts[${idx}].startDate must be YYYY-MM-DD`)
      }

      // if endDate missing or invalid -> auto
      c.endDate = isValidYMD(c.endDate) ? s(c.endDate) : endFromStartYMD(c.startDate)

      // normalize carry
      c.carry = normalizeCarryObj(c.carry)

      // snapshots: if exist, ensure carry normalized too
      if (c.openSnapshot) {
        c.openSnapshot.carry = normalizeCarryObj(c.openSnapshot.carry)
      }
      if (c.closeSnapshot) {
        c.closeSnapshot.carry = normalizeCarryObj(c.closeSnapshot.carry)
      }
    })

    this.contracts = sorted

    // pointers must follow latest contract
    const latest = pickLatestContract(this.contracts)
    if (!latest) throw new Error('contracts cannot be empty')

    this.contractDate = s(latest.startDate)
    this.contractEndDate = s(latest.endDate)

    if (!isValidYMD(this.contractDate)) throw new Error('contractDate must be YYYY-MM-DD')
    if (!isValidYMD(this.contractEndDate)) throw new Error('contractEndDate must be YYYY-MM-DD')

    next()
  } catch (e) {
    next(e)
  }
})

/* ───────────────── statics ───────────────── */
LeaveProfileSchema.statics.APPROVAL_MODE = APPROVAL_MODE
LeaveProfileSchema.statics.normalizeApprovalMode = normalizeApprovalMode

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)