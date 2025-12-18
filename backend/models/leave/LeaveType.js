const mongoose = require('mongoose')

const LeaveTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // AL, SP, MC, MA, UL
    name: { type: String, required: true },
    description: { type: String, default: '' },

    // Optional config fields
    requiresBalance: { type: Boolean, default: true },
    yearlyEntitlement: { type: Number, default: 0 },   // display entitlement
    accrualPerMonth: { type: Number, default: 0 },     // AL = 1.5
    yearlyLimit: { type: Number, default: 0 },         // 0 = unlimited (for UL)
    fixedDurationDays: { type: Number, default: 0 },   // MA = 90
    allowNegative: { type: Boolean, default: false },  // AL true (SP borrowing)

    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    order: { type: Number, default: 999 },
  },
  { timestamps: true }
)

module.exports = mongoose.model('LeaveType', LeaveTypeSchema)
