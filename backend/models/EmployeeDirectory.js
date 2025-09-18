// backend/models/EmployeeDirectory.js

const mongoose = require('mongoose')

const EmployeeDirectorySchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true, trim: true },
  name:       { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  isActive:   { type: Boolean, default: true }
}, { timestamps: true })

module.exports = mongoose.model('EmployeeDirectory', EmployeeDirectorySchema)
