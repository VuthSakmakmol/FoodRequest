// backend/models/food/RecurringTemplate.js
const mongoose = require('mongoose');

/* ---------- Enums ---------- */
const MENU_ENUM = ['Standard', 'Vegetarian', 'Vegan', 'No pork', 'No beef'];
const ALLERGEN_ENUM = ['Peanut', 'Shellfish', 'Egg', 'Gluten', 'Dairy/Lactose', 'Soy', 'Others'];

/* ---------- Subschemas ---------- */
const MenuCountSchema = new mongoose.Schema(
  {
    choice: { type: String, enum: MENU_ENUM, required: true },
    count: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const DietaryCountSchema = new mongoose.Schema(
  {
    allergen: { type: String, enum: ALLERGEN_ENUM, required: true },
    count: { type: Number, min: 1, required: true },
    menu: { type: String, enum: MENU_ENUM, default: 'Standard' },
  },
  { _id: false }
);

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, required: true }, // e.g., SCHEDULE_NEXT, PAUSE, RESUME, CANCEL, SKIP_TODAY
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

/* ---------- RecurringTemplate ---------- */
const RecurringTemplateSchema = new mongoose.Schema(
  {
    owner: {
      employeeId: { type: String, required: true, index: true },
      name: { type: String, default: '' },
      department: { type: String, default: '' },
    },

    // Occurrence payload
    orderType: { type: String, enum: ['Daily meal', 'Meeting catering', 'Visitor meal'], default: 'Daily meal' },
    meals: { type: [String], default: [] },
    quantity: { type: Number, min: 1, required: true },

    location: {
      kind: { type: String, enum: ['Meeting Room', 'Canteen', 'Other'], default: 'Canteen' },
      other: { type: String, default: '' },
    },

    menuChoices: [{ type: String, enum: MENU_ENUM, default: 'Standard' }],
    menuCounts: { type: [MenuCountSchema], default: [] },

    dietary: [{ type: String, enum: ALLERGEN_ENUM }],
    dietaryCounts: { type: [DietaryCountSchema], default: [] },
    dietaryOther: { type: String, default: '' },

    specialInstructions: { type: String, default: '' },

    // Frequency window
    frequency: { type: String, enum: ['Daily', 'Weekly', 'Monthly'], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    skipHolidays: { type: Boolean, default: true },

    // Optional time window
    eatTimeStart: { type: String, default: null }, // 'HH:mm'
    eatTimeEnd: { type: String, default: null },

    // Engine control
    timezone: { type: String, default: 'Asia/Phnom_Penh' },
    status: { type: String, enum: ['ACTIVE', 'PAUSED', 'CANCELED'], default: 'ACTIVE', index: true },
    nextRunAt: { type: Date, default: null, index: true }, // UTC timestamp
    skipDates: { type: [String], default: [] }, // 'YYYY-MM-DD'

    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

/* ---------- Indexes ---------- */
RecurringTemplateSchema.index({ 'owner.employeeId': 1, status: 1 });
RecurringTemplateSchema.index({ status: 1, nextRunAt: 1 });

module.exports =
  mongoose.models.RecurringTemplate ||
  mongoose.model('RecurringTemplate', RecurringTemplateSchema);
