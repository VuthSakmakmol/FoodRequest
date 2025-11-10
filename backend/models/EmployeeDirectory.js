//models/EmployeeDirectory.js
const mongoose = require('mongoose')

const EmployeeDirectorySchema = new mongoose.Schema({
  employeeId:   { type: String, required: true, unique: true, trim: true },
  name:         { type: String, required: true, trim: true },
  department:   { type: String, required: true, trim: true },
  telegramChatId: { type: String, default: '' },
  contactNumber:{
    type: String, trim: true,
    match: [/^\+?\d[\d\s\-()]{5,20}$/, 'Invalid contact number format']
  },
  isActive:     { type: Boolean, default: true }
}, { timestamps: true })

module.exports = mongoose.model('EmployeeDirectory', EmployeeDirectorySchema)
