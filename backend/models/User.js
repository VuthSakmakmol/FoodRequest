// backend/models/User.js
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const ROLES = Object.freeze([
  'ROOT_ADMIN',
  'ADMIN',
  'EMPLOYEE',

  'CHEF',
  'DRIVER',
  'MESSENGER',

  'ROOM_ADMIN',
  'MATERIAL_ADMIN',

  'LEAVE_USER',
  'LEAVE_MANAGER',
  'LEAVE_GM',
  'LEAVE_COO',
  'LEAVE_ADMIN',
])

function s(v) {
  return String(v ?? '').trim()
}

function normRole(v) {
  return s(v).toUpperCase()
}

function uniq(arr) {
  return Array.from(new Set(arr))
}

const UserSchema = new mongoose.Schema(
  {
    loginId: { type: String, required: true, unique: true, trim: true, index: true },

    // ✅ NEW: keep employee identity for realtime/business modules
    employeeId: { type: String, default: '', trim: true, index: true },

    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },

    role: { type: String, enum: ROLES, default: 'LEAVE_USER' },
    roles: { type: [String], enum: ROLES, default: [] },

    isActive: { type: Boolean, default: true },

    telegramChatId: { type: String, default: '', trim: true },
    telegramUsername: { type: String, default: '', trim: true },

    passwordChangedAt: { type: Date, default: null },
    passwordVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
)

UserSchema.index({ telegramChatId: 1 })

UserSchema.pre('validate', function (next) {
  try {
    this.loginId = s(this.loginId)
    this.employeeId = s(this.employeeId)
    this.name = s(this.name)
    this.telegramChatId = s(this.telegramChatId)
    this.telegramUsername = s(this.telegramUsername)

    const role = normRole(this.role)

    const rolesArrRaw = Array.isArray(this.roles) ? this.roles : []
    const rolesArr = rolesArrRaw
      .map(normRole)
      .filter(Boolean)
      .filter((r) => ROLES.includes(r))

    if (role && ROLES.includes(role) && !rolesArr.includes(role)) {
      rolesArr.push(role)
    }

    if ((!role || !ROLES.includes(role)) && rolesArr.length) {
      this.role = rolesArr[0]
    } else if (role && ROLES.includes(role)) {
      this.role = role
    }

    const finalRole =
      normRole(this.role) && ROLES.includes(normRole(this.role))
        ? normRole(this.role)
        : 'LEAVE_USER'

    const finalRoles = uniq(
      (rolesArr.length ? rolesArr : [finalRole]).filter((r) => ROLES.includes(r))
    )

    this.role = finalRole
    this.roles = finalRoles

    next()
  } catch (e) {
    next(e)
  }
})

UserSchema.methods.setPassword = async function (plain) {
  const nextPw = s(plain)
  this.passwordHash = await bcrypt.hash(nextPw, 10)
  this.passwordChangedAt = new Date()
  this.passwordVersion = Number(this.passwordVersion || 0) + 1
}

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(s(plain), this.passwordHash)
}

UserSchema.statics.ROLES = ROLES

module.exports = mongoose.model('User', UserSchema)