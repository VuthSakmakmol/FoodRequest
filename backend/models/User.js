// models/User.js
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

/**
 * ✅ Single source of truth for allowed roles
 * Make sure this matches your router + portals + backend checks.
 */
const ROLES = Object.freeze([
  // main system
  'ROOT_ADMIN',
  'ADMIN',
  'EMPLOYEE',

  // food/transport portals
  'CHEF',
  'DRIVER',
  'MESSENGER',

  // leave portal
  'LEAVE_USER',
  'LEAVE_MANAGER',
  'LEAVE_GM',
  'LEAVE_COO',
  'LEAVE_ADMIN',
])

function normRole(v) {
  return String(v || '').trim().toUpperCase()
}

function uniq(arr) {
  return Array.from(new Set(arr))
}

const UserSchema = new mongoose.Schema(
  {
    loginId: { type: String, required: true, unique: true, trim: true, index: true },
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

/**
 * ✅ Harden roles sync:
 * - always normalize to UPPERCASE
 * - always keep `role` and `roles[]` consistent
 * - never allow empty `roles[]`
 */
UserSchema.pre('validate', function (next) {
  try {
    // normalize role
    const role = normRole(this.role)

    // normalize roles array
    const rolesArrRaw = Array.isArray(this.roles) ? this.roles : []
    const rolesArr = rolesArrRaw
      .map(normRole)
      .filter(Boolean)
      .filter(r => ROLES.includes(r))

    // If role exists and valid, ensure it exists in roles[]
    if (role && ROLES.includes(role) && !rolesArr.includes(role)) {
      rolesArr.push(role)
    }

    // If role missing but roles[] exists -> set role = first
    if ((!role || !ROLES.includes(role)) && rolesArr.length) {
      this.role = rolesArr[0]
    } else if (role && ROLES.includes(role)) {
      this.role = role
    }

    // If roles[] ended empty -> enforce default from role or LEAVE_USER
    const finalRole = normRole(this.role) && ROLES.includes(normRole(this.role))
      ? normRole(this.role)
      : 'LEAVE_USER'

    const finalRoles = uniq(
      (rolesArr.length ? rolesArr : [finalRole]).filter(r => ROLES.includes(r))
    )

    this.role = finalRole
    this.roles = finalRoles

    next()
  } catch (e) {
    next(e)
  }
})

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(String(plain || ''), this.passwordHash)
}

UserSchema.statics.ROLES = ROLES

module.exports = mongoose.model('User', UserSchema)
