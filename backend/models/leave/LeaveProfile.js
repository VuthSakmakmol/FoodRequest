// backend/models/leave/LeaveProfile.js
const mongoose = require('mongoose')

const BalanceSchema = new mongoose.Schema(
  {
    leaveTypeCode: { type: String, required: true },
    yearlyEntitlement: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  },
  { _id: false }
)

const LeaveProfileSchema = new mongoose.Schema(
  {
    employeeId:       { type: String, required: true, index: true, unique: true },
    employeeLoginId:  { type: String, required: true },
    managerLoginId:   { type: String, required: true },
    gmLoginId:        { type: String, required: true },

    // NEW (for admin page)
    joinDate:         { type: Date },
    contractDate:     { type: Date },
    balances:         { type: [BalanceSchema], default: [] },

    isActive:         { type: Boolean, default: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('LeaveProfile', LeaveProfileSchema)
