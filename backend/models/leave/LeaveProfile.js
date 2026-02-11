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

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

/**
 * ✅ Only 3 approval modes in the whole system (semantic)
 */
const APPROVAL_MODE = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])

/**
 * Normalize old/stored values to ONLY the 3 semantic values.
 * - Old profile schema used: GM_ONLY / GM_AND_COO (or variants)
 * - Some old code used: GM_OR_COO
 */
function normalizeApprovalMode(v) {
  const raw = up(v)

  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  // legacy profile values
  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'GM_OR_COO') return 'GM_AND_COO'
  if (raw === 'GM_COO') return 'GM_AND_COO'
  if (raw === 'COO_AND_GM') return 'GM_AND_COO'
  if (raw === 'GM_THEN_COO') return 'GM_AND_COO'

  // safest default
  return 'MANAGER_AND_GM'
}

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

const BalanceSchema = new mongoose.Schema(
  {
    leaveTypeCode: { type: String, required: true }, // AL/SP/MC/MA/UL
    yearlyEntitlement: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  },
  { _id: false }
)

// ✅ Carry schema (positive or negative allowed)
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
    balances: { type: [BalanceSchema], default: [] },

    contractDate: { type: String, default: '' }, // start
    contractEndDate: { type: String, default: '' }, // end

    // ✅ snapshot carry (at close time)
    carry: { type: CarrySchema, default: () => ({}) },
  },
  { _id: false }
)

const ContractHistorySchema = new mongoose.Schema(
  {
    contractNo: { type: Number, required: true },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },

    // ✅ IMPORTANT: per-contract carry (this is what we edit)
    carry: { type: CarrySchema, default: () => ({}) },

    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    openedBy: { type: String, default: '' },
    closedBy: { type: String, default: '' },
    note: { type: String, default: '' },
    closeSnapshot: { type: ContractSnapshotSchema, default: null },

    // legacy mirror (keep if you already have data using it)
    alCarry: { type: Number, default: undefined },
  },
  { _id: false }
)

// ─────────────────────────────────────────────────────────────
// Main Profile
// ─────────────────────────────────────────────────────────────

const LeaveProfileSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, index: true },
    employeeLoginId: { type: String, default: '' },

    // approver1 (optional)
    managerLoginId: { type: String, default: '' },

    // approver2
    gmLoginId: { type: String, default: '' },

    // approver3
    cooLoginId: { type: String, default: '' },

    /**
     * ✅ approval mode: ONLY 3 values
     * - MANAGER_AND_GM
     * - MANAGER_AND_COO
     * - GM_AND_COO
     */
    approvalMode: {
      type: String,
      enum: APPROVAL_MODE,
      default: 'MANAGER_AND_GM',
    },

    name: { type: String, default: '' },
    department: { type: String, default: '' },

    joinDate: { type: String, default: '' }, // YYYY-MM-DD

    // pointers for "current contract"
    contractDate: { type: String, default: '' }, // current start
    contractEndDate: { type: String, default: '' }, // current end

    isActive: { type: Boolean, default: true },

    balances: { type: [BalanceSchema], default: [] },
    balancesAsOf: { type: String, default: '' },

    // ✅ contract history (each contract has its own carry)
    contracts: { type: [ContractHistorySchema], default: [] },

    // ─────────────────────────────
    // LEGACY ONLY (keep temporarily)
    // ─────────────────────────────
    carry: { type: CarrySchema, default: undefined },
    alCarry: { type: Number, default: undefined },

    // legacy profile enum (if old json still writes here) — keep but not required
    // (if you don't have this field in DB, remove it)
    // approvalModeLegacy: { type: String, default: undefined },

    contractExpiryNotifiedFor: { type: String, default: '' },
    contractExpiryNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

// ─────────────────────────────────────────────────────────────
// Helpers for contracts
// ─────────────────────────────────────────────────────────────

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

function contractEndFromStart(startYMD) {
  if (!isValidYMD(startYMD)) return ''
  return addDaysYMD(addYearsYMD(startYMD, 1), -1)
}

function pickLatestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null

  const withStart = arr.filter((c) => isValidYMD(c?.startDate))
  if (withStart.length) {
    return withStart.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  }
  return arr.slice().sort((a, b) => num(b.contractNo) - num(a.contractNo))[0]
}

function ensureContractNumbers(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  const hasAny = arr.some((c) => typeof c?.contractNo === 'number' && Number.isFinite(c.contractNo))
  if (!hasAny) {
    const sorted = arr
      .slice()
      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
    sorted.forEach((c, idx) => {
      c.contractNo = idx + 1
    })
    return sorted
  }
  return arr
}

// ─────────────────────────────────────────────────────────────
// Pre-validate: ensure approvalMode + contract pointers + migrate legacy carry
// ─────────────────────────────────────────────────────────────

LeaveProfileSchema.pre('validate', function (next) {
  try {
    // ✅ normalize approvalMode to ONLY 3 modes
    this.approvalMode = normalizeApprovalMode(this.approvalMode)

    // If contractDate missing, use joinDate
    if (!this.contractDate && this.joinDate) this.contractDate = this.joinDate

    // Ensure contractEndDate always matches contractDate (current pointer)
    if (isValidYMD(this.contractDate)) {
      this.contractEndDate = contractEndFromStart(this.contractDate)
    }

    // Ensure contracts array exists
    if (!Array.isArray(this.contracts)) this.contracts = []

    // Ensure contract numbers are sane
    this.contracts = ensureContractNumbers(this.contracts)

    // ─────────────────────────────────────────────
    // ✅ Migration / Initialization
    // If no contracts exist yet, create initial contract
    // and move legacy carry into it.
    // ─────────────────────────────────────────────
    if (this.contracts.length === 0) {
      const start = isValidYMD(this.contractDate)
        ? String(this.contractDate)
        : isValidYMD(this.joinDate)
          ? String(this.joinDate)
          : ''

      if (start) {
        const legacyCarry = normalizeCarryObj(this.carry)
        if (num(legacyCarry.AL) === 0 && typeof this.alCarry === 'number' && num(this.alCarry) !== 0) {
          legacyCarry.AL = num(this.alCarry)
        }

        this.contracts.push({
          contractNo: 1,
          startDate: start,
          endDate: contractEndFromStart(start),
          carry: legacyCarry,
          alCarry: num(legacyCarry.AL),
          openedAt: new Date(),
          openedBy: 'legacy-migration',
          note: 'Initial contract (auto-created)',
          closeSnapshot: null,
        })
      }
    } else {
      // If contracts exist, ensure each contract has endDate + carry initialized
      this.contracts.forEach((c) => {
        if (isValidYMD(c.startDate) && !isValidYMD(c.endDate)) {
          c.endDate = contractEndFromStart(c.startDate)
        }
        c.carry = normalizeCarryObj(c.carry)
        c.alCarry = num(c.carry.AL)
      })

      // ✅ Move legacy profile-level carry into latest contract ONLY if contract carry is empty
      const latest = pickLatestContract(this.contracts)
      if (latest) {
        const latestCarry = normalizeCarryObj(latest.carry)
        const isLatestCarryEmpty =
          num(latestCarry.AL) === 0 &&
          num(latestCarry.SP) === 0 &&
          num(latestCarry.MC) === 0 &&
          num(latestCarry.MA) === 0 &&
          num(latestCarry.UL) === 0

        if (isLatestCarryEmpty) {
          const legacyCarry = normalizeCarryObj(this.carry)
          if (num(legacyCarry.AL) === 0 && typeof this.alCarry === 'number' && num(this.alCarry) !== 0) {
            legacyCarry.AL = num(this.alCarry)
          }

          const hasLegacy =
            num(legacyCarry.AL) !== 0 ||
            num(legacyCarry.SP) !== 0 ||
            num(legacyCarry.MC) !== 0 ||
            num(legacyCarry.MA) !== 0 ||
            num(legacyCarry.UL) !== 0

          if (hasLegacy) {
            latest.carry = legacyCarry
            latest.alCarry = num(legacyCarry.AL)
          }
        }

        // Keep profile pointers aligned to latest contract for UI
        if (isValidYMD(latest.startDate)) {
          this.contractDate = latest.startDate
          this.contractEndDate = isValidYMD(latest.endDate) ? latest.endDate : contractEndFromStart(latest.startDate)
        }
      }
    }

    next()
  } catch (e) {
    next(e)
  }
})

LeaveProfileSchema.statics.APPROVAL_MODE = APPROVAL_MODE
LeaveProfileSchema.statics.normalizeApprovalMode = normalizeApprovalMode

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)
