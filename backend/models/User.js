const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  loginId:     { type: String, required: true, unique: true, trim: true },
  name:        { type: String, required: true, trim: true },
  passwordHash:{ type: String, required: true },
  role:        { type: String, enum: ['ADMIN','CHEF'], required: true },
  isActive:    { type: Boolean, default: true }
}, { timestamps: true })

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

module.exports = mongoose.model('User', UserSchema)
