// backend/routes/bookingRoom/AdminMaterial.routes.js
const express = require('express')
const router = express.Router()

const auth = require('../../middlewares/auth')
const ctrl = require('../../controllers/bookingRoom/MaterialAdmin.controller')

function h(fn, name) {
  if (typeof fn !== 'function') {
    console.error(`[materialAdmin.routes] Missing handler: ${name}`)
    return (_req, res) =>
      res.status(500).json({
        message: `Server misconfigured: missing handler "${name}".`,
      })
  }
  return fn
}

router.use(auth.requireAuth)

/* ───────────────── Public/helper active materials (auth only mount) ───────────────── */
router.get('/active-materials', h(ctrl.listActiveMaterials, 'listActiveMaterials'))

/* ───────────────── Material admin users ───────────────── */
router.get(
  '/admin/material-admins',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listMaterialAdmins, 'listMaterialAdmins')
)

/* ───────────────── Material inbox / decision ───────────────── */
router.get(
  '/material/inbox',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listMaterialInbox, 'listMaterialInbox')
)

router.post(
  '/:id/material-decision',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.materialDecision, 'materialDecision')
)

/* ───────────────── Material master CRUD ───────────────── */
router.get(
  '/admin/materials',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.listMaterialMasters, 'listMaterialMasters')
)

router.post(
  '/admin/materials',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.createMaterialMaster, 'createMaterialMaster')
)

router.patch(
  '/admin/materials/:id',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.updateMaterialMaster, 'updateMaterialMaster')
)

router.delete(
  '/admin/materials/:id',
  auth.requireRole('MATERIAL_ADMIN', 'ADMIN', 'ROOT_ADMIN'),
  h(ctrl.deleteMaterialMaster, 'deleteMaterialMaster')
)

module.exports = router