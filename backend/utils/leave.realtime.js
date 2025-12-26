/* eslint-disable no-console */
// backend/utils/leave.realtime.js

const { ROOMS, emitToRoom } = require('./realtime')

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const log = (...args) => {
  if (!isProd) console.log('[leave:io]', ...args)
}

const str = (v) => (v == null ? '' : String(v).trim())

// Keep LEAVE_ROOMS for compatibility with your old imports
const LEAVE_ROOMS = Object.freeze({
  ADMINS: ROOMS.ADMINS,
  EMPLOYEE: (employeeId) => ROOMS.EMPLOYEE(str(employeeId)),
  USER: (loginId) => ROOMS.USER(str(loginId)),
})

/**
 * Broadcast LeaveRequest change to:
 * - admins room (leave admins watching)
 * - employee room (employee profile / balances)
 * - requester user room (employee login room)
 * - manager / gm / coo user rooms (their inbox)
 *
 * Usage:
 *   broadcastLeaveRequest(io, doc, 'leave:req:updated')
 */
function broadcastLeaveRequest(io, docOrPlain, event, payloadOverride) {
  if (!io || !docOrPlain || !event) return

  const body =
    payloadOverride ||
    (typeof docOrPlain?.toObject === 'function'
      ? docOrPlain.toObject()
      : docOrPlain)

  const employeeId = str(body.employeeId)
  const requester  = str(body.requesterLoginId)
  const manager    = str(body.managerLoginId)
  const gm         = str(body.gmLoginId)
  const coo        = str(body.cooLoginId)

  const rooms = new Set([
    LEAVE_ROOMS.ADMINS,
    employeeId && LEAVE_ROOMS.EMPLOYEE(employeeId),
    requester && LEAVE_ROOMS.USER(requester),
    manager && LEAVE_ROOMS.USER(manager),
    gm && LEAVE_ROOMS.USER(gm),
    coo && LEAVE_ROOMS.USER(coo),
  ])

  if (!isProd) {
    log('broadcastLeaveRequest', event, {
      _id: body?._id,
      employeeId,
      requester,
      manager,
      gm,
      coo,
      rooms: [...rooms].filter(Boolean),
    })
  }

  for (const room of rooms) {
    if (!room) continue
    emitToRoom(io, room, event, body)
  }
}

/**
 * Broadcast LeaveProfile changes to:
 * - admins room
 * - employee room
 * - user rooms (employee, manager, gm, coo)
 *
 * Usage:
 *   broadcastLeaveProfile(io, doc, 'leave:profile:updated')
 */
function broadcastLeaveProfile(io, docOrPlain, event, payloadOverride) {
  if (!io || !docOrPlain || !event) return

  const body =
    payloadOverride ||
    (typeof docOrPlain?.toObject === 'function'
      ? docOrPlain.toObject()
      : docOrPlain)

  const employeeId  = str(body.employeeId || body.employeeLoginId)
  const managerLogin = str(body.managerLoginId)
  const gmLogin      = str(body.gmLoginId)
  const cooLogin     = str(body.cooLoginId)

  const rooms = new Set([
    LEAVE_ROOMS.ADMINS,
    employeeId && LEAVE_ROOMS.EMPLOYEE(employeeId),

    // many places in your system treat employeeId == loginId
    employeeId && LEAVE_ROOMS.USER(employeeId),

    managerLogin && LEAVE_ROOMS.USER(managerLogin),
    gmLogin && LEAVE_ROOMS.USER(gmLogin),
    cooLogin && LEAVE_ROOMS.USER(cooLogin),
  ])

  if (!isProd) {
    log('broadcastLeaveProfile', event, {
      _id: body?._id,
      employeeId,
      managerLogin,
      gmLogin,
      cooLogin,
      rooms: [...rooms].filter(Boolean),
    })
  }

  for (const room of rooms) {
    if (!room) continue
    emitToRoom(io, room, event, body)
  }
}

module.exports = {
  LEAVE_ROOMS,
  broadcastLeaveRequest,
  broadcastLeaveProfile,
}
