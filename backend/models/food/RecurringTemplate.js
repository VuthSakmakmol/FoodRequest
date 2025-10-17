// backend/models/food/RecurringTemplate.js
const mongoose = require('mongoose');

const RecurringTemplateSchema = new mongoose.Schema({
  owner: {
    employeeId: { type: String, required: true, index: true },
    name:       { type: String, required: true },
    department: { type: String, default: '' }
  },

  orderType:   { type: String, required: true },      // e.g. 'Daily meal'
  meals:       [{ type: String, required: true }],    // ['Breakfast', ...]
  quantity:    { type: Number, required: true, min: 1 },

  location: {
    kind:  { type: String, required: true },          // 'Canteen' | 'Office' | 'Other'
    other: { type: String, default: '' }
  },

  menuChoices: [{ type: String, required: true }],    // ['Standard', 'Vegan', ...]
  menuCounts: [{
    choice: { type: String, required: true },
    count:  { type: Number, required: true, min: 1 }
  }],

  dietary:        [{ type: String }],
  dietaryOther:   { type: String, default: '' },
  dietaryCounts:  [{
    allergen: { type: String, required: true },
    menu:     { type: String, default: 'Standard' },
    count:    { type: Number, required: true, min: 1 }
  }],

  // schedule
  frequency:   { type: String, default: 'Daily' },    // future-proof
  startDate:   { type: Date,   required: true },
  endDate:     { type: Date,   required: true },
  skipHolidays:{ type: Boolean, default: false },

  eatTimeStart:{ type: String, default: null },       // 'HH:mm' or null
  eatTimeEnd:  { type: String, default: null },

  timezone:    { type: String, default: 'Asia/Phnom_Penh' },

  status:      { type: String, default: 'ACTIVE', index: true }, // ACTIVE/PAUSED/ENDED
  nextRunAt:   { type: Date,   default: null, index: true },
  skipDates:   [{ type: String }]                     // ['YYYY-MM-DD']
}, { timestamps: true });

module.exports = mongoose.model('RecurringTemplate', RecurringTemplateSchema);
