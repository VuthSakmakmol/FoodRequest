// backend/models/leave/LeaveType.js
const mongoose = require('mongoose')

const LeaveTypeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },

  /**
   * Does this type require a balance check?
   * - true  => we will validate remaining days / yearly limits
   * - false => allowed even if balance is 0 (e.g. Unpaid)
   */
  requiresBalance: {
    type: Boolean,
    default: true,
  },

  /**
   * Yearly entitlement in days (if applicable)
   * AL = 18, MC = 60, MA = 90, SP = 7, UL = 0 (unlimited)
   */
  yearlyEntitlement: {
    type: Number,
    default: 0,
  },

  /**
   * Monthly accrual (for AL only in your rule: 1.5 days / month)
   */
  accrualPerMonth: {
    type: Number,
    default: 0,
  },

  /**
   * Hard limit per year (e.g. SP = 7 days / year, MC = 60 days / year)
   * 0 or null = no explicit yearly cap enforced by this field
   */
  yearlyLimit: {
    type: Number,
    default: 0,
  },

  /**
   * For fixed-duration types:
   * - MA (maternity) must always be 90 days
   * If > 0, backend can enforce requestedDays == fixedDurationDays
   */
  fixedDurationDays: {
    type: Number,
    default: 0,
  },

  /**
   * Allow negative balance? (Borrowing)
   * - AL: true (can go negative via SP)
   * - others: false
   */
  allowNegative: {
    type: Boolean,
    default: false,
  },

  /**
   * Is this type active for selection?
   */
  isActive: {
    type: Boolean,
    default: true,
  },

  /**
   * Mark system-defined types so you can protect them
   * from deletion or code changes in admin screens.
   */
  isSystem: {
    type: Boolean,
    default: false,
  },

  /**
   * For ordering dropdowns / lists.
   */
  order: {
    type: Number,
    default: 0,
  },
}, { timestamps: true })

LeaveTypeSchema.index({ code: 1 })

module.exports = mongoose.model('LeaveType', LeaveTypeSchema)
