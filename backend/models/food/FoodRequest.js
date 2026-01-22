// backend/models/food/FoodRequest.js
const mongoose = require('mongoose')

/* ---------- Atomic counter for human IDs ---------- */
const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. 'foodrequest'
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
)
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema)

/* ---------- Enums ---------- */
const STATUS = ['NEW', 'ACCEPTED', 'CANCELED']
const MENU_ENUM = ['Standard', 'Vegetarian', 'Vegan', 'No pork', 'No beef']
const ALLERGEN_ENUM = ['Peanut', 'Shellfish', 'Egg', 'Gluten', 'Dairy/Lactose', 'Soy', 'Others']

/* ---------- Subschemas ---------- */
const MenuCountSchema = new mongoose.Schema(
  {
    choice: { type: String, enum: MENU_ENUM, required: true },
    count: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
)

const DietaryCountSchema = new mongoose.Schema(
  {
    allergen: { type: String, enum: ALLERGEN_ENUM, required: true },
    count: { type: Number, min: 0, default: 0 },
    menu: { type: String, enum: MENU_ENUM, default: 'Standard' },
  },
  { _id: false }
)

/* ---------- FoodRequest ---------- */
const FoodRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true }, // FR-0001

    employee: {
      employeeId: { type: String, required: true, index: true },
      name: { type: String, required: true },
      department: { type: String, required: true },
    },

    orderDate: { type: Date, default: Date.now, required: true },
    eatDate: { type: Date, required: true },
    eatTimeStart: { type: String }, // "HH:mm"
    eatTimeEnd: { type: String },

    orderType: {
      type: String,
      enum: ['Daily meal', 'Meeting catering', 'Visitor meal'],
      required: true,
    },
    meals: [{ type: String, enum: ['Breakfast', 'Lunch', 'Dinner', 'Snack'], required: true }],
    quantity: { type: Number, min: 1, required: true },

    location: {
      kind: { type: String, enum: ['Meeting Room', 'Canteen', 'Other'], required: true },
      other: { type: String, default: '' },
    },

    menuChoices: [{ type: String, enum: MENU_ENUM }],
    menuCounts: [MenuCountSchema],

    dietary: [{ type: String, enum: ALLERGEN_ENUM }],
    dietaryCounts: [DietaryCountSchema],
    dietaryOther: { type: String, default: '' },

    specialInstructions: { type: String, default: '' },
    cancelReason: { type: String, default: '' },

    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['Daily', 'Weekly', 'Monthly'], default: null },
      endDate: { type: Date },
      skipHolidays: { type: Boolean, default: true },
      parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRequest' },

      source: { type: String, enum: ['RECURRING', 'MANUAL'], default: 'MANUAL' },
      templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringTemplate' },
      occurrenceDate: { type: String }, // 'YYYY-MM-DD'
    },

    status: { type: String, enum: STATUS, default: 'NEW', index: true },
    statusHistory: [
      {
        status: { type: String, required: true },
        by: { type: String }, // optional (ADMIN/CHEF/loginId)
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
)

/* ---------- Indexes ---------- */
FoodRequestSchema.index(
  { requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } }, name: 'uniq_requestId' }
)

FoodRequestSchema.index({ eatDate: 1, status: 1 }, { name: 'by_eatDate_status' })
FoodRequestSchema.index({ 'employee.employeeId': 1, eatDate: 1 }, { name: 'by_employee_eatDate' })

FoodRequestSchema.index(
  { 'recurring.templateId': 1, 'recurring.occurrenceDate': 1 },
  {
    unique: true,
    name: 'uniq_recurring_template_occurrence',
    partialFilterExpression: {
      'recurring.templateId': { $type: 'objectId' },
      'recurring.occurrenceDate': { $type: 'string', $exists: true, $ne: '' },
    },
  }
)

/* ---------- Auto-generate requestId ---------- */
FoodRequestSchema.pre('validate', async function (next) {
  try {
    if (!this.requestId) {
      const c = await Counter.findOneAndUpdate(
        { _id: 'foodrequest' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      )
      const n = String(c.seq).padStart(4, '0')
      this.requestId = `FR-${n}`
    }
    next()
  } catch (err) {
    next(err)
  }
})

/* ---------- Normalize recurring fields (avoid null keys) ---------- */
FoodRequestSchema.pre('save', function (next) {
  if (!this.recurring) return next()
  const r = this.recurring

  const shouldOmit = !r.enabled || r.source !== 'RECURRING'
  if (shouldOmit) {
    if ('templateId' in r && (r.templateId === null || r.templateId === undefined)) delete r.templateId
    if ('occurrenceDate' in r && (!r.occurrenceDate || r.occurrenceDate === '')) delete r.occurrenceDate
    return next()
  }

  if (r.templateId == null) delete r.templateId
  if (!r.occurrenceDate) delete r.occurrenceDate

  next()
})

module.exports = mongoose.models.FoodRequest || mongoose.model('FoodRequest', FoodRequestSchema)
