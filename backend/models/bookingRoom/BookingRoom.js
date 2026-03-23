// backend/models/bookingRoom/BookingRoom.js
const mongoose = require('mongoose')

function safeStr(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return safeStr(v).toUpperCase()
}

const ROOM_STATUS = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']
const MATERIAL_STATUS = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']
const OVERALL_STATUS = ['PENDING', 'PARTIAL_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED']

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
 * room snapshot
 * ───────────────────────────── */
const RequestedRoomSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomResource',
    },
    roomCode: { type: String, default: '', trim: true, uppercase: true },
    roomName: { type: String, default: '', trim: true },
  },
  { _id: false }
)

/* ─────────────────────────────
 * material snapshot
 * ───────────────────────────── */
const RequestedMaterialSchema = new mongoose.Schema(
  {
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomMaterial',
    },
    materialCode: { type: String, required: true, trim: true, uppercase: true },
    materialName: { type: String, default: '', trim: true },
    qty: { type: Number, required: true, min: 1, default: 1 },
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
    timeEnd: { type: String, required: true, trim: true }, // HH:mm

    recurringId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookingRoomRecurring',
      default: null,
      index: true,
    },
    isRecurring: {
      type: Boolean,
      default: false,
      index: true,
    },
    recurringIndex: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* request detail */
    meetingTitle: { type: String, default: '', trim: true },
    purpose: { type: String, default: '', trim: true },
    participantEstimate: { type: Number, default: 1, min: 1 },
    note: { type: String, default: '', trim: true },
    needCoffeeBreak: { type: Boolean, default: false },

    /* room section */
    roomRequired: { type: Boolean, default: false, index: true },

    // legacy/simple direct fields kept for easier compatibility
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'BookingRoomResource',
      index: true,
    },
    roomCode: { type: String, default: '', trim: true, uppercase: true, index: true },
    roomName: { type: String, default: '', trim: true, index: true },

    // room snapshot
    room: { type: RequestedRoomSchema, default: null },

    /* material section */
    materialRequired: { type: Boolean, default: false, index: true },
    materials: {
      type: [RequestedMaterialSchema],
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
BookingRoomSchema.index({ roomCode: 1, bookingDate: 1, roomStatus: 1 })
BookingRoomSchema.index({ roomName: 1, bookingDate: 1, roomStatus: 1 })
BookingRoomSchema.index({ bookingDate: 1, overallStatus: 1 })
BookingRoomSchema.index({ roomStatus: 1, materialStatus: 1, overallStatus: 1 })
BookingRoomSchema.index({ 'materials.materialCode': 1, bookingDate: 1, materialStatus: 1 })
BookingRoomSchema.index({ recurringId: 1, bookingDate: 1 })
BookingRoomSchema.index({ employeeId: 1, recurringId: 1 })

function emptyApproval() {
  return {
    byLoginId: '',
    byName: '',
    decision: '',
    note: '',
    decidedAt: null,
  }
}

function deriveOverallStatus(doc) {
  const room = up(doc.roomStatus)
  const material = up(doc.materialStatus)
  const overall = up(doc.overallStatus)

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

function normalizeRoomFields(doc) {
  const roomObj = doc.room && typeof doc.room === 'object' ? doc.room : {}

  const roomId = roomObj.roomId || doc.roomId || null
  const roomCode = up(roomObj.roomCode || doc.roomCode)
  const roomName = safeStr(roomObj.roomName || doc.roomName)

  doc.roomId = roomId
  doc.roomCode = roomCode
  doc.roomName = roomName

  if (roomId || roomCode || roomName) {
    doc.room = {
      roomId,
      roomCode,
      roomName,
    }
  } else {
    doc.room = null
  }
}

function normalizeMaterialItems(items) {
  if (!Array.isArray(items)) return []

  const normalized = []
  const map = new Map()

  for (const raw of items) {
    const materialId = raw?.materialId || null
    const materialCode = up(raw?.materialCode)
    const materialName = safeStr(raw?.materialName)
    const qty = Number(raw?.qty || 0)

    if (!materialCode) continue
    if (!Number.isFinite(qty) || qty <= 0) continue

    const key = materialCode

    if (!map.has(key)) {
      map.set(key, {
        materialId,
        materialCode,
        materialName,
        qty,
      })
    } else {
      const old = map.get(key)
      old.qty += qty

      if (!old.materialId && materialId) old.materialId = materialId
      if (!old.materialName && materialName) old.materialName = materialName
    }
  }

  for (const item of map.values()) {
    normalized.push(item)
  }

  return normalized
}

BookingRoomSchema.pre('validate', function (next) {
  try {
    this.employeeId = safeStr(this.employeeId)
    this.bookingDate = safeStr(this.bookingDate)
    this.timeStart = safeStr(this.timeStart)
    this.timeEnd = safeStr(this.timeEnd)
    this.meetingTitle = safeStr(this.meetingTitle)
    this.purpose = safeStr(this.purpose)
    this.note = safeStr(this.note)
    this.needCoffeeBreak = !!this.needCoffeeBreak
    this.cancelReason = safeStr(this.cancelReason)

    if (!this.employee || !safeStr(this.employee.employeeId)) {
      this.employee = {
        employeeId: this.employeeId,
        name: safeStr(this.employee?.name),
        department: safeStr(this.employee?.department),
        position: safeStr(this.employee?.position),
        contactNumber: safeStr(this.employee?.contactNumber),
      }
    } else {
      this.employee = {
        employeeId: safeStr(this.employee.employeeId),
        name: safeStr(this.employee.name),
        department: safeStr(this.employee.department),
        position: safeStr(this.employee.position),
        contactNumber: safeStr(this.employee.contactNumber),
      }
    }

    normalizeRoomFields(this)

    if (!this.roomRequired) {
      this.roomId = null
      this.roomCode = ''
      this.roomName = ''
      this.room = null
      this.roomStatus = 'NOT_REQUIRED'
      this.roomApproval = emptyApproval()
      this.needCoffeeBreak = false
    } else {
      if (!this.roomCode && !this.roomName) {
        return next(new Error('roomCode or roomName is required when roomRequired is true.'))
      }

      if (!this.roomStatus || up(this.roomStatus) === 'NOT_REQUIRED') {
        this.roomStatus = 'PENDING'
      }
    }

    this.materials = normalizeMaterialItems(this.materials)

    if (!this.materialRequired) {
      this.materials = []
      this.materialStatus = 'NOT_REQUIRED'
      this.materialApproval = emptyApproval()
    } else {
      if (!this.materials.length) {
        return next(new Error('materials is required when materialRequired is true.'))
      }

      if (!this.materialStatus || up(this.materialStatus) === 'NOT_REQUIRED') {
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

BookingRoomSchema.methods.hasAnyApprovedSection = function () {
  return up(this.roomStatus) === 'APPROVED' || up(this.materialStatus) === 'APPROVED'
}

BookingRoomSchema.methods.canRequesterEditOrCancel = function () {
  const overall = up(this.overallStatus)
  if (overall === 'CANCELLED') return false
  return !this.hasAnyApprovedSection()
}

BookingRoomSchema.methods.recomputeOverallStatus = function () {
  this.overallStatus = deriveOverallStatus(this)
  return this.overallStatus
}

BookingRoomSchema.statics.ROOM_STATUS = ROOM_STATUS
BookingRoomSchema.statics.MATERIAL_STATUS = MATERIAL_STATUS
BookingRoomSchema.statics.OVERALL_STATUS = OVERALL_STATUS

module.exports = mongoose.model('BookingRoom', BookingRoomSchema, 'booking_rooms')