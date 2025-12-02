// models/User.js
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

// ✅ extended roles (future-proof)
const ROLES = Object.freeze([
  'ADMIN',
  'CHEF',
  'DRIVER',
  'MESSENGER',
  'LEAVE_USER',    // expat / employee who requests leave
  'LEAVE_MANAGER', // approver (line manager)
  'LEAVE_GM',      // final approver
  'LEAVE_ADMIN',   // HR / system admin for leave
])

const UserSchema = new mongoose.Schema({
  loginId:      { type: String, required: true, unique: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ROLES, required: true },
  isActive:     { type: Boolean, default: true },

  // Telegram private DM linkage
  telegramChatId:   { type: String, default: '' },   // e.g. "537250678"
  telegramUsername: { type: String, default: '' },   // optional
}, { timestamps: true })

UserSchema.index({ telegramChatId: 1 }) // helpful, not unique

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}
UserSchema.statics.ROLES = ROLES

module.exports = mongoose.model('User', UserSchema)
