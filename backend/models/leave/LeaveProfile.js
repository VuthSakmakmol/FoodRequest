// backend/models/leave/LeaveProfile.js
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
  },
  { timestamps: true }
)

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)
