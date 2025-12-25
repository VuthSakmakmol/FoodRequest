// models/User.js
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

// ✅ extended roles (future-proof)
const ROLES = Object.freeze([
  'ADMIN',
  'CHEF',
  'DRIVER',
  'MESSENGER',

  'LEAVE_USER',
  'LEAVE_MANAGER',
  'LEAVE_GM',
  'LEAVE_ADMIN',

  // optional if you want
  'LEAVE_COO',
])

const UserSchema = new mongoose.Schema(
  {
    loginId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },

    // ✅ legacy single role (keep for old code)
    role: { type: String, enum: ROLES, default: 'LEAVE_USER' },

    // ✅ multi-role (NEW)
    roles: { type: [String], enum: ROLES, default: [] },

    isActive: { type: Boolean, default: true },

    // Telegram private DM linkage
    telegramChatId: { type: String, default: '' },
    telegramUsername: { type: String, default: '' },
  },
  { timestamps: true }
)

UserSchema.index({ telegramChatId: 1 })

// ✅ ensure roles always include legacy role
UserSchema.pre('validate', function (next) {
  try {
    const r = String(this.role || '').trim()
    const arr = Array.isArray(this.roles) ? this.roles : []

    // If roles empty but role exists -> seed roles
    if (r && !arr.includes(r)) this.roles = [...new Set([...arr, r])]

    // If role empty but roles[] has items -> set role = first
    if (!r && arr.length) this.role = arr[0]

    next()
  } catch (e) {
    next(e)
  }
})

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

UserSchema.statics.ROLES = ROLES

module.exports = mongoose.model('User', UserSchema)
