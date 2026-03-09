// backend/models/bookingRoom/BookingRoom.js
const mongoose = require('mongoose')

function safeStr(v) {
  return String(v ?? '').trim()
}

const ROOM_STATUS = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']
const MATERIAL_STATUS = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']
const OVERALL_STATUS = ['PENDING', 'PARTIAL_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED']
const MATERIAL_TYPES = ['PROJECTOR', 'TV']

/* ─────────────────────────────
 * requester snapshot
 * ───────────────────────────── */
const EmployeeSnapshotSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    position: { type: String, default: '', trim: true },
    contactNumber: { type: String, default: '', trim: true },
  },
  { _id: false }
)

/* ─────────────────────────────
 * approval section
 * ───────────────────────────── */
const ApprovalActionSchema = new mongoose.Schema(
  {
    byLoginId: { type: String, default: '', trim: true },
    byName: { type: String, default: '', trim: true },
    decision: {
      type: String,
      enum: ['', 'APPROVED', 'REJECTED'],
      default: '',
    },
    note: { type: String, default: '', trim: true },
    decidedAt: { type: Date, default: null },
  },
  { _id: false }
)

/* ─────────────────────────────
 * main schema
 * ───────────────────────────── */
const BookingRoomSchema = new mongoose.Schema(
  {
    /* requester */
    employeeId: { type: String, required: true, trim: true, index: true },
    employee: { type: EmployeeSnapshotSchema, required: true },

    /* booking time */
    bookingDate: { type: String, required: true, trim: true, index: true }, // YYYY-MM-DD
    timeStart: { type: String, required: true, trim: true }, // HH:mm
    timeEnd: { type: String, required: true, trim: true },   // HH:mm

    /* request detail */
    meetingTitle: { type: String, default: '', trim: true },
    purpose: { type: String, default: '', trim: true },
    participantEstimate: { type: Number, default: 1, min: 1 },
    requirementNote: { type: String, default: '', trim: true },

    /* room section */
    roomRequired: { type: Boolean, default: false, index: true },
    roomName: { type: String, default: '', trim: true, index: true },

    /* material section */
    materialRequired: { type: Boolean, default: false, index: true },
    materials: {
      type: [String],
      enum: MATERIAL_TYPES,
      default: [],
    },

    /* statuses */
    roomStatus: {
      type: String,
      enum: ROOM_STATUS,
      default: 'NOT_REQUIRED',
      index: true,
    },
    materialStatus: {
      type: String,
      enum: MATERIAL_STATUS,
      default: 'NOT_REQUIRED',
      index: true,
    },
    overallStatus: {
      type: String,
      enum: OVERALL_STATUS,
      default: 'PENDING',
      index: true,
    },

    /* approvals */
    roomApproval: {
      type: ApprovalActionSchema,
      default: () => ({}),
    },
    materialApproval: {
      type: ApprovalActionSchema,
      default: () => ({}),
    },

    /* public/meta */
    submittedVia: {
      type: String,
      enum: ['PUBLIC_FORM', 'ADMIN_FORM'],
      default: 'PUBLIC_FORM',
    },
    cancelReason: { type: String, default: '', trim: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'booking_rooms',
  }
)

/* ─────────────────────────────
 * indexes
 * ───────────────────────────── */
BookingRoomSchema.index({ bookingDate: 1, timeStart: 1 })
BookingRoomSchema.index({ employeeId: 1, createdAt: -1 })
BookingRoomSchema.index({ roomName: 1, bookingDate: 1, roomStatus: 1 })
BookingRoomSchema.index({ bookingDate: 1, overallStatus: 1 })
BookingRoomSchema.index({ roomStatus: 1, materialStatus: 1, overallStatus: 1 })

/* ─────────────────────────────
 * helpers
 * ───────────────────────────── */
function deriveOverallStatus(doc) {
  const room = safeStr(doc.roomStatus).toUpperCase()
  const material = safeStr(doc.materialStatus).toUpperCase()
  const overall = safeStr(doc.overallStatus).toUpperCase()

  if (overall === 'CANCELLED') return 'CANCELLED'

  const statuses = [room, material].filter(Boolean)

  const activeStatuses = statuses.filter((s) => s !== 'NOT_REQUIRED')

  if (!activeStatuses.length) return 'PENDING'

  const approvedCount = activeStatuses.filter((s) => s === 'APPROVED').length
  const rejectedCount = activeStatuses.filter((s) => s === 'REJECTED').length
  const pendingCount = activeStatuses.filter((s) => s === 'PENDING').length

  if (approvedCount === activeStatuses.length) return 'APPROVED'
  if (rejectedCount === activeStatuses.length) return 'REJECTED'
  if (approvedCount > 0) return 'PARTIAL_APPROVED'
  if (approvedCount === 0 && pendingCount > 0) return 'PENDING'
  if (rejectedCount > 0 && pendingCount > 0) return 'PENDING'

  return 'PENDING'
}

/* ─────────────────────────────
 * validation + normalization
 * ───────────────────────────── */
BookingRoomSchema.pre('validate', function (next) {
  try {
    this.employeeId = safeStr(this.employeeId)
    this.bookingDate = safeStr(this.bookingDate)
    this.timeStart = safeStr(this.timeStart)
    this.timeEnd = safeStr(this.timeEnd)
    this.meetingTitle = safeStr(this.meetingTitle)
    this.purpose = safeStr(this.purpose)
    this.requirementNote = safeStr(this.requirementNote)
    this.roomName = safeStr(this.roomName)
    this.cancelReason = safeStr(this.cancelReason)

    if (!this.employee || !safeStr(this.employee.employeeId)) {
      this.employee = {
        employeeId: this.employeeId,
        name: safeStr(this.employee?.name),
        department: safeStr(this.employee?.department),
        position: safeStr(this.employee?.position),
        contactNumber: safeStr(this.employee?.contactNumber),
      }
    }

    if (!this.roomRequired) {
      this.roomName = ''
      this.roomStatus = 'NOT_REQUIRED'
      this.roomApproval = {
        byLoginId: '',
        byName: '',
        decision: '',
        note: '',
        decidedAt: null,
      }
    } else {
      if (!this.roomName) {
        return next(new Error('roomName is required when roomRequired is true.'))
      }
      if (!this.roomStatus || this.roomStatus === 'NOT_REQUIRED') {
        this.roomStatus = 'PENDING'
      }
    }

    this.materials = Array.isArray(this.materials)
      ? [...new Set(this.materials.map((v) => safeStr(v).toUpperCase()).filter(Boolean))]
      : []

    if (!this.materialRequired) {
      this.materials = []
      this.materialStatus = 'NOT_REQUIRED'
      this.materialApproval = {
        byLoginId: '',
        byName: '',
        decision: '',
        note: '',
        decidedAt: null,
      }
    } else {
      if (!this.materials.length) {
        return next(new Error('materials is required when materialRequired is true.'))
      }
      if (!this.materialStatus || this.materialStatus === 'NOT_REQUIRED') {
        this.materialStatus = 'PENDING'
      }
    }

    if (!this.roomRequired && !this.materialRequired) {
      return next(new Error('At least one of roomRequired or materialRequired must be true.'))
    }

    this.overallStatus = deriveOverallStatus(this)
    this.updatedAt = new Date()

    next()
  } catch (err) {
    next(err)
  }
})

/* ─────────────────────────────
 * instance methods
 * ───────────────────────────── */
BookingRoomSchema.methods.hasAnyApprovedSection = function () {
  return ['APPROVED'].includes(safeStr(this.roomStatus).toUpperCase()) ||
    ['APPROVED'].includes(safeStr(this.materialStatus).toUpperCase())
}

BookingRoomSchema.methods.canRequesterEditOrCancel = function () {
  const overall = safeStr(this.overallStatus).toUpperCase()
  if (overall === 'CANCELLED') return false
  return !this.hasAnyApprovedSection()
}

BookingRoomSchema.methods.recomputeOverallStatus = function () {
  this.overallStatus = deriveOverallStatus(this)
  return this.overallStatus
}

/* ─────────────────────────────
 * statics
 * ───────────────────────────── */
BookingRoomSchema.statics.ROOM_STATUS = ROOM_STATUS
BookingRoomSchema.statics.MATERIAL_STATUS = MATERIAL_STATUS
BookingRoomSchema.statics.OVERALL_STATUS = OVERALL_STATUS
BookingRoomSchema.statics.MATERIAL_TYPES = MATERIAL_TYPES

module.exports = mongoose.model('BookingRoom', BookingRoomSchema, 'booking_rooms')