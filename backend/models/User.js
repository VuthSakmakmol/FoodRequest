// models/User.js
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

// Optional: centralize role values
const ROLES = Object.freeze(['ADMIN', 'CHEF', 'DRIVER', 'MESSENGER'])

const UserSchema = new mongoose.Schema({
  loginId:      { type: String, required: true, unique: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ROLES, required: true }, // added DRIVER, MESSENGER
  isActive:     { type: Boolean, default: true }
}, { timestamps: true })

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

// (Optional) expose roles if you want to reuse elsewhere
UserSchema.statics.ROLES = ROLES

module.exports = mongoose.model('User', UserSchema)
