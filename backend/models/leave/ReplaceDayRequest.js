// backend/models/leave/ReplaceDayRequest.js
const mongoose = require('mongoose')

const EvidenceSchema = new mongoose.Schema(
  {
    filename:   { type: String, default: '' },
    mimetype:   { type: String, default: '' },
    size:       { type: Number, default: 0 },
    data:       { type: Buffer, required: true }, // ✅ stored in MongoDB
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
)

const ReplaceDayRequestSchema = new mongoose.Schema(
  {
    employeeId:        { type: String, required: true, index: true },
    requesterLoginId:  { type: String, required: true, index: true },

    requestDate:       { type: String, required: true }, // YYYY-MM-DD (any day)
    compensatoryDate:  { type: String, required: true }, // YYYY-MM-DD (must be working day)
    reason:            { type: String, default: '' },

    // ✅ multiple evidences
    evidences: { type: [EvidenceSchema], default: [] },

    status: {
      type: String,
      enum: ['PENDING_MANAGER', 'PENDING_GM', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING_MANAGER',
      index: true,
    },

    managerLoginId: { type: String, required: true, index: true },
    gmLoginId:      { type: String, required: true, index: true },

    managerComment:    { type: String, default: '' },
    managerDecisionAt: { type: Date, default: null },

    gmComment:    { type: String, default: '' },
    gmDecisionAt: { type: Date, default: null },

    cancelledAt:   { type: Date, default: null },
    cancelledById: { type: String, default: '' },
  },
  { timestamps: true }
)

// optional: prevent exact duplicate requests
ReplaceDayRequestSchema.index(
  { employeeId: 1, requestDate: 1, compensatoryDate: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'CANCELLED' } } }
)

module.exports = mongoose.model('ReplaceDayRequest', ReplaceDayRequestSchema)
