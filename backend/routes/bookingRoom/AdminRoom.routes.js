const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const upload = require('../../middlewares/bookingRoomUpload')
const ctrl = require('../../controllers/bookingRoom/RoomAdmin.controller')

function h(fn, name) {
  if (typeof fn !== 'function') {
    console.error(`[roomAdmin.routes] Missing handler: ${name}`)
    return (_req, res) =>
      res.status(500).json({
        message: `Server misconfigured: missing handler "${name}".`,
      })
  }
  return fn
}

router.use(auth.requireAuth)

/* ───────────────── Public/helper active rooms (auth only mount) ───────────────── */
router.get('/active-rooms', h(ctrl.listActiveRooms, 'listActiveRooms'))

/* ───────────────── Room admin users ───────────────── */
router.get(
  '/admin/room-admins',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listRoomAdmins, 'listRoomAdmins')
)

/* ───────────────── Room inbox / decision ───────────────── */
router.get(
  '/room/inbox',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listRoomInbox, 'listRoomInbox')
)

router.post(
  '/:id/room-decision',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.roomDecision, 'roomDecision')
)

/* ───────────────── Room master CRUD ───────────────── */
router.get(
  '/admin/rooms',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listRoomMasters, 'listRoomMasters')
)

router.get(
  '/admin/rooms/:id/image',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.streamRoomImage, 'streamRoomImage')
)

router.post(
  '/admin/rooms',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  upload.single('image'),
  h(ctrl.createRoomMaster, 'createRoomMaster')
)

router.patch(
  '/admin/rooms/:id',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  upload.single('image'),
  h(ctrl.updateRoomMaster, 'updateRoomMaster')
)

router.delete(
  '/admin/rooms/:id',
  auth.requireRole('ROOM_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.deleteRoomMaster, 'deleteRoomMaster')
)

module.exports = router