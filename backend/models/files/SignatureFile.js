// backend/models/files/SignatureFile.js
const mongoose = require('mongoose')

const SignatureFileSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['employees', 'users'], required: true, index: true },
    ownerId: { type: String, required: true, index: true },

    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },

    filename: { type: String, default: '' },
    contentType: { type: String, default: '' },
    size: { type: Number, default: 0 },

    uploadedBy: { type: String, default: '' },
  },
  { timestamps: true }
)

SignatureFileSchema.index({ kind: 1, ownerId: 1 }, { unique: true })

module.exports = mongoose.model('SignatureFile', SignatureFileSchema)
