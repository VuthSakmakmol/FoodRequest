const mongoose = require('mongoose')

const LeaveContractReminderLogSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true, index: true },
    contractNo: { type: Number, required: true, index: true },
    reminderType: {
      type: String,
      required: true,
      enum: ['D30', 'D14', 'D7', 'D1'],
      index: true,
    },
    contractEndDate: { type: String, required: true, trim: true },
    sentAt: { type: Date, default: Date.now },
    sentTo: [{ type: String, trim: true }],
    note: { type: String, default: '' },
  },
  { timestamps: true }
)

LeaveContractReminderLogSchema.index(
  { employeeId: 1, contractNo: 1, reminderType: 1 },
  { unique: true, name: 'uniq_leave_contract_reminder' }
)

module.exports = mongoose.model('LeaveContractReminderLog', LeaveContractReminderLogSchema)