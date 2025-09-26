// backend/models/FoodRequest.js
const mongoose = require('mongoose');

/* ---------- Atomic counter for human IDs ---------- */
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'foodrequest'
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

/* ---------- Helpers ---------- */
const STATUS = ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'DELIVERED', 'CANCELED'];
const stepKey = (status) =>
  ({
    NEW: 'newAt',
    ACCEPTED: 'acceptedAt',
    COOKING: 'cookingAt',
    READY: 'readyAt',
    DELIVERED: 'deliveredAt',
    CANCELED: 'canceledAt',
  }[status]);

/* ---------- Enums ---------- */
const MENU_ENUM = ['Standard', 'Vegetarian', 'Vegan', 'No pork', 'No beef'];
const ALLERGEN_ENUM = ['Peanut', 'Shellfish', 'Egg', 'Gluten', 'Dairy/Lactose', 'Soy', 'Others'];

/* ---------- Subschemas ---------- */
const MenuCountSchema = new mongoose.Schema(
  {
    choice: { type: String, enum: MENU_ENUM, required: true },
    count: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const DietaryCountSchema = new mongoose.Schema(
  {
    allergen: { type: String, enum: ALLERGEN_ENUM, required: true },
    count: { type: Number, min: 0, default: 0 },
    menu: { type: String, enum: MENU_ENUM, default: 'Standard' },
  },
  { _id: false }
);

/* ---------- FoodRequest ---------- */
const FoodRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, unique: true, required: true }, // e.g. FR-0001

    employee: {
      employeeId: { type: String, required: true },
      name: { type: String, required: true },
      department: { type: String, required: true },
    },

    // Dates/times
    orderDate: { type: Date, default: Date.now, required: true }, // created "today"
    eatDate: { type: Date, required: true }, // day to serve (calendar key)
    eatTimeStart: { type: String }, // "HH:mm"
    eatTimeEnd: { type: String },

    // Order info
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

    // Menu + counts
    menuChoices: [{ type: String, enum: MENU_ENUM }],
    menuCounts: [MenuCountSchema], // [{choice, count}]

    // Dietary + counts
    dietary: [{ type: String, enum: ALLERGEN_ENUM }],
    dietaryCounts: [DietaryCountSchema], // [{allergen, count, menu}]
    dietaryOther: { type: String, default: '' },

    specialInstructions: { type: String, default: '' },
    cancelReason: { type: String, default: '' },

    // Recurring options
    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['Daily', 'Weekly', 'Monthly'], default: null },
      endDate: { type: Date },
      skipHolidays: { type: Boolean, default: true },
      parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRequest', default: null },
    },

    // Status
    status: { type: String, enum: STATUS, default: 'NEW', index: true },
    statusHistory: [
      {
        status: { type: String, required: true },
        by: { type: String },
        at: { type: Date, default: Date.now },
      },
    ],

    // Telegram guard
    notified: {
      deliveredAt: { type: Date, default: null },
    },

    // First-time timestamps for each step
    stepDates: {
      newAt: { type: Date, default: null },
      acceptedAt: { type: Date, default: null },
      cookingAt: { type: Date, default: null },
      readyAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      canceledAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

/* ---------- Indexes ---------- */
FoodRequestSchema.index(
  { requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } }
);
// For calendar & admin queries by date/status
FoodRequestSchema.index({ eatDate: 1, status: 1 });

/* ---------- Auto-generate requestId before validation ---------- */
FoodRequestSchema.pre('validate', async function (next) {
  try {
    if (!this.requestId) {
      const c = await Counter.findOneAndUpdate(
        { _id: 'foodrequest' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const n = String(c.seq).padStart(4, '0'); // FR-0001, …
      this.requestId = `FR-${n}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

/* ---------- Initialize stepDates.newAt on creation ---------- */
FoodRequestSchema.pre('save', function (next) {
  if (this.isNew) {
    if (!this.stepDates) this.stepDates = {};
    if (!this.stepDates.newAt) this.stepDates.newAt = new Date();
  }
  next();
});

/* ---------- Track status changes (first-time stamps) ---------- */
FoodRequestSchema.pre('findOneAndUpdate', function (next) {
  try {
    const update = this.getUpdate() || {};
    const $set = update.$set || update;
    const newStatus = $set?.status;

    const key = stepKey(newStatus);
    if (newStatus && key) {
      // propose setting the step time if not set
      this.setUpdate({
        ...update,
        $set: {
          ...(update.$set || {}),
          [`stepDates.${key}`]:
            update.$set?.[`stepDates.${key}`] !== undefined
              ? update.$set[`stepDates.${key}`]
              : new Date(),
        },
        ...(update.$push ? { $push: update.$push } : {}),
      });

      // if already had a timestamp for this key, don't override it
      this.model
        .findOne(this.getQuery())
        .then((doc) => {
          if (doc?.stepDates?.[key]) {
            const u = this.getUpdate();
            if (u?.$set) {
              delete u.$set[`stepDates.${key}`];
              if (Object.keys(u.$set).length === 0) delete u.$set;
              this.setUpdate(u);
            }
          }
          next();
        })
        .catch(next);
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.models.FoodRequest || mongoose.model('FoodRequest', FoodRequestSchema);
