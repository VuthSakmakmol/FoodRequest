// backend/routes/bookingRoom/bookingRoom.routes.js
const express = require('express')
const router = express.Router()

const ctrl = require('../../controllers/bookingRoom/bookingRoom.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth')

// ✅ all below require login
router.use(requireAuth)

/* ───────────────── Room admin ───────────────── */
router.get(
  '/booking-room/room/inbox',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listRoomInbox
)

router.post(
  '/booking-room/:id/room-decision',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.roomDecision
)

/* ───────────────── Material admin ───────────────── */
router.get(
  '/booking-room/material/inbox',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listMaterialInbox
)

router.post(
  '/booking-room/:id/material-decision',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.materialDecision
)

/* ───────────────── Shared admin view ───────────────── */
router.get(
  '/booking-room/admin/list',
  requireRole('ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listAdmin
)

router.get(
  '/booking-room/admin/export',
  requireRole('ROOM_ADMIN', 'MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.exportAdminExcel
)

/* ───────────────── Helper lists ───────────────── */
router.get(
  '/booking-room/admin/room-admins',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listRoomAdmins
)

router.get(
  '/booking-room/admin/material-admins',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listMaterialAdmins
)

module.exports = router