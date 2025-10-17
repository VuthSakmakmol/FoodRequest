const mongoose = require('mongoose')
const { Schema, Types } = mongoose

const TransportationRecurringSeriesSchema = new Schema({
  createdBy:    { type: Types.ObjectId, ref: 'User', required: true },
  createdByEmp: {
    employeeId: { type: String, default: '' },
    name:       { type: String, default: '' },
    department: { type: String, default: '' },
    contactNumber: { type: String, default: '' }
  },

  category:     { type: String, enum: ['Car','Messenger'], required: true },
  passengers:   { type: Number, default: 1, min: 1 },
  customerContact: { type: String, default: '' },

  stops: [{
    destination: { type: String, required: true, trim: true },
    destinationOther: { type: String, default: '', trim: true },
    mapLink: { type: String, default: '', trim: true }
  }],

  purpose:      { type: String, default: '' },
  notes:        { type: String, default: '' },

  startDate:    { type: String, required: true }, // YYYY-MM-DD
  endDate:      { type: String, required: true },
  timeStart:    { type: String, required: true }, // HH:MM
  timeEnd:      { type: String, required: true },
  timezone:     { type: String, default: 'Asia/Phnom_Penh' },
  skipHolidays: { type: Boolean, default: true },

  status:       { type: String, enum: ['ACTIVE','PAUSED','CANCELLED'], default:'ACTIVE' }
}, { timestamps: true, collection: 'transport_recurring_series' })

module.exports = mongoose.model('TransportationRecurringSeries', TransportationRecurringSeriesSchema)
