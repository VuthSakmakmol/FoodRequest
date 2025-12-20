const mongoose = require('mongoose')

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
    alCarry: { type: Number, default: 0 },
    contractDate: { type: String, default: '' }, // contract start at that time
  },
  { _id: false }
)

const ContractHistorySchema = new mongoose.Schema(
  {
    contractNo: { type: Number, required: true }, // 1,2,3...
    startDate: { type: String, default: '' },     // YYYY-MM-DD
    endDate: { type: String, default: '' },       // YYYY-MM-DD (set when closed)
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },

    openedBy: { type: String, default: '' }, // req.user.loginId (optional)
    closedBy: { type: String, default: '' },

    note: { type: String, default: '' },

    closeSnapshot: { type: ContractSnapshotSchema, default: null },
  },
  { _id: false }
)

const LeaveProfileSchema = new mongoose.Schema(
  {
    // identity
    employeeId: { type: String, required: true, unique: true, index: true },
    employeeLoginId: { type: String, default: '' }, // usually same as employeeId

    // manager / gm (loginId format in your project = employeeId string)
    managerLoginId: { type: String, default: '' },
    gmLoginId: { type: String, default: '' },

    // directory snapshot (for grouped UI)
    name: { type: String, default: '' },
    department: { type: String, default: '' },

    // dates
    joinDate: { type: String, default: '' },     // YYYY-MM-DD
    contractDate: { type: String, default: '' }, // YYYY-MM-DD (current contract start)

    // AL carry (debt allowed)
    alCarry: { type: Number, default: 0 },

    // active
    isActive: { type: Boolean, default: true },

    // persisted computed balances (what frontend displays)
    balances: { type: [BalanceSchema], default: [] },
    balancesAsOf: { type: String, default: '' }, // YYYY-MM-DD

    // ✅ per-contract history/progress
    contracts: { type: [ContractHistorySchema], default: [] },
  },
  { timestamps: true }
)

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)
