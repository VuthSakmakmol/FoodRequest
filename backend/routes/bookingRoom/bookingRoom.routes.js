const express = require('express')
const router = express.Router()

const ctrl = require('../../controllers/bookingRoom/bookingRoom.controller')
const { requireAuth, requireRole } = require('../../middlewares/auth')

// ✅ all below require login
router.use(requireAuth)

/* ───────────────── Room admin inbox / decision ───────────────── */
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

/* ───────────────── Material admin inbox / decision ───────────────── */
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

/* ───────────────── Shared admin booking list / export ───────────────── */
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

/* ───────────────── Room master CRUD ───────────────── */
router.get(
  '/booking-room/admin/rooms',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listRoomMasters
)

router.post(
  '/booking-room/admin/rooms',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.createRoomMaster
)

router.patch(
  '/booking-room/admin/rooms/:id',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.updateRoomMaster
)

router.delete(
  '/booking-room/admin/rooms/:id',
  requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.deleteRoomMaster
)

/* ───────────────── Material master CRUD ───────────────── */
router.get(
  '/booking-room/admin/materials',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.listMaterialMasters
)

router.post(
  '/booking-room/admin/materials',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.createMaterialMaster
)

router.patch(
  '/booking-room/admin/materials/:id',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.updateMaterialMaster
)

router.delete(
  '/booking-room/admin/materials/:id',
  requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  ctrl.deleteMaterialMaster
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