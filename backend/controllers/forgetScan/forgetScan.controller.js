/* eslint-disable no-console */
// backend/controllers/forgetScan/forgetScan.controller.js
//
// ✅ ExpatForgetScan (STANDARDIZED to SwapWorkingDay controller)
// ✅ Approval modes:
//    - MANAGER_AND_GM   : PENDING_MANAGER -> PENDING_GM  -> APPROVED
//    - MANAGER_AND_COO  : PENDING_MANAGER -> PENDING_COO -> APPROVED
//    - GM_AND_COO       : PENDING_GM      -> PENDING_COO -> APPROVED
//    - MANAGER_ONLY     : PENDING_MANAGER -> APPROVED
//    - GM_ONLY          : PENDING_GM      -> APPROVED
//    - COO_ONLY         : PENDING_COO     -> APPROVED
//
// ✅ Viewers: LEAVE_ADMIN/ADMIN/ROOT_ADMIN can VIEW inbox via scope=ALL (but cannot decide)
// ✅ Decisions: NO admin bypass (only exact role)
// ✅ Lock rule: once ANY approval activity happened (actedAt / APPROVED / REJECTED),
//               requester cannot edit/cancel.
// ✅ Duplicate protection handled by Mongo partial unique index (model)
// ✅ COO inbox: viewerModes are restricted to same cooLoginId (not global)
//
// NOTE: Attachments are not handled here. Keep GridFS evidence endpoints separate.

const createError = require('http-errors')

const ExpatForgetScanRequest = require('../../models/forgetScan/ExpatForgetScanRequest')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

/* ───────────────── notify (Telegram) ───────────────── */
let notify = null
try {
  notify = require('../../services/telegram/forgetScan')
  console.log('✅ forgetscan telegram notify loaded')
} catch (e) {
  console.warn('⚠️ forgetscan telegram notify NOT loaded:', e?.message)
  notify = null
}

async function safeNotify(fn, ...args) {
  try {
    if (typeof fn !== 'function') return
    return await fn(...args)
  } catch (e) {
    console.warn('⚠️ forgetscan telegram notify failed:', e?.response?.data || e?.message)
  }
}

/* ───────────────── realtime ───────────────── */
const { broadcastForgetScanRequest } = require('../../utils/forgetScan.realtime')

function getIo(req) {
  return req.io || req.app?.get('io') || null
}
function emitForget(req, payload, event = 'forgetscan:req:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastForgetScanRequest(io, payload, event)
  } catch (e) {
    console.warn('⚠️ forgetscan realtime emit failed:', e?.message)
  }
}

/* ───────────────── helpers ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => up(x)).filter(Boolean))]
}
function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

/**
 * ✅ Robust identity
 * We return ids[] for matching approver loginId fields safely.
 */
function getActor(req) {
  const loginId = s(req.user?.loginId || req.user?.sub || req.user?.id || req.user?.username || '')
  const employeeLoginId = s(req.user?.employeeLoginId || '')
  const employeeId = s(req.user?.employeeId || req.user?.empId || '')
  const ids = [...new Set([loginId, employeeLoginId, employeeId].filter(Boolean))]
  return { loginId, employeeId, employeeLoginId, ids }
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.sub || req.user?.id || req.user?.username || req.user?.employeeId || req.user?.empId || '')
}
function actorIds(req) {
  const a = getActor(req)
  return a.ids
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('ROOT_ADMIN') || roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')
}

function hasRole(req, ...allow) {
  const roles = getRoles(req)
  const a = allow.map(up)
  return roles.some((r) => a.includes(r))
}

// ✅ can VIEW inbox pages
function canViewManagerInbox(req) {
  return hasRole(req, 'LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewGmInbox(req) {
  return hasRole(req, 'LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}
function canViewCooInbox(req) {
  return hasRole(req, 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN', 'ROOT_ADMIN')
}

// ✅ can DECIDE (NO admin bypass)
function canManagerDecide(req) {
  return hasRole(req, 'LEAVE_MANAGER')
}
function canGmDecide(req) {
  return hasRole(req, 'LEAVE_GM')
}
function canCooDecide(req) {
  return hasRole(req, 'LEAVE_COO')
}

/* ✅ lock edit/cancel once ANY approval activity happened */
function hasAnyApprovalActivity(approvals) {
  const arr = Array.isArray(approvals) ? approvals : []
  return arr.some((a) => {
    const st = up(a?.status)
    return !!a?.actedAt || st === 'APPROVED' || st === 'REJECTED'
  })
}
function ensureRequesterCanEditOrCancel(doc) {
  if (hasAnyApprovalActivity(doc?.approvals)) {
    throw createError(400, 'This request already started approval. You cannot edit or cancel it.')
  }
}
function ensureOwner(doc, loginId) {
  if (s(doc.requesterLoginId) !== s(loginId)) throw createError(403, 'Not your request')
}

/* ───────────────── forgot types ───────────────── */
const FORGOT_TYPES = ['FORGET_IN', 'FORGET_OUT']

function normalizeForgotTypesFromBody(body) {
  let arr = Array.isArray(body?.forgotTypes) ? body.forgotTypes : []
  if (!arr.length && body?.forgotType) arr = [body.forgotType]
  arr = uniqUpper(arr).filter((x) => FORGOT_TYPES.includes(x))

  if (arr.length < 1 || arr.length > 2) {
    throw createError(400, 'forgotTypes must contain 1 or 2 items: FORGET_IN / FORGET_OUT')
  }
  return arr
}

/* ───────────────── attach employee info ───────────────── */
async function attachEmployeeInfo(rows = []) {
  const ids = [...new Set((rows || []).map((d) => s(d.employeeId)).filter(Boolean))]
  if (!ids.length) return rows

  const emps = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  const map = new Map((emps || []).map((e) => [s(e.employeeId), e]))

  return (rows || []).map((d) => {
    const emp = map.get(s(d.employeeId))
    return {
      ...d,
      employeeName: emp?.name || emp?.fullName || d.employeeName || '',
      department: emp?.departmentName || emp?.department || d.department || '',
    }
  })
}

async function attachEmployeeInfoToOne(doc) {
  if (!doc) return doc
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const employeeId = s(raw.employeeId)
  if (!employeeId) return raw

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  return {
    ...raw,
    employeeName: emp?.name || emp?.fullName || raw.employeeName || '',
    department: emp?.departmentName || emp?.department || raw.department || '',
  }
}

/* ───────────────── approval mode helpers ───────────────── */
function normalizeMode(v) {
  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'MANAGER_ONLY') return 'MANAGER_ONLY'
  if (raw === 'GM_ONLY') return 'GM_ONLY'
  if (raw === 'COO_ONLY') return 'COO_ONLY'
  // fallback
  return 'MANAGER_AND_GM'
}

function allowedStatusesForInboxLevel(level) {
  const lvl = up(level)
  if (lvl === 'MANAGER') return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  if (lvl === 'GM') return ['PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  if (lvl === 'COO') return ['PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
  return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO', 'APPROVED', 'REJECTED', 'CANCELLED']
}

function initialStatusForMode(mode) {
  const m = normalizeMode(mode)
  if (m === 'COO_ONLY') return 'PENDING_COO'
  if (m === 'GM_AND_COO') return 'PENDING_GM'
  if (m === 'GM_ONLY') return 'PENDING_GM'
  return 'PENDING_MANAGER'
}

function buildApprovalsOrThrow(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeMode(mode)
  const reqLogin = (label, id) => {
    const v = s(id)
    if (!v) throw createError(400, `${label} is required for approvalMode ${m}`)
    return v
  }

  if (m === 'COO_ONLY') {
    return [{ level: 'COO', loginId: reqLogin('cooLoginId', cooLoginId), status: 'PENDING', actedAt: null, note: '' }]
  }
  if (m === 'MANAGER_ONLY') {
    return [{ level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' }]
  }
  if (m === 'GM_ONLY') {
    return [{ level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' }]
  }
  if (m === 'MANAGER_AND_GM') {
    return [
      { level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }
  if (m === 'MANAGER_AND_COO') {
    return [
      { level: 'MANAGER', loginId: reqLogin('managerLoginId', managerLoginId), status: 'PENDING', actedAt: null, note: '' },
      { level: 'COO', loginId: reqLogin('cooLoginId', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
    ]
  }
  // GM_AND_COO
  return [
    { level: 'GM', loginId: reqLogin('gmLoginId', gmLoginId), status: 'PENDING', actedAt: null, note: '' },
    { level: 'COO', loginId: reqLogin('cooLoginId', cooLoginId), status: 'PENDING', actedAt: null, note: '' },
  ]
}

function markApproval(approvals, level, status, note = '') {
  const arr = Array.isArray(approvals) ? approvals : []
  const lvl = up(level)
  const idx = arr.findIndex((a) => up(a.level) === lvl)
  if (idx >= 0) {
    arr[idx].status = status
    arr[idx].actedAt = new Date()
    arr[idx].note = s(note || '')
  }
  return arr
}

function nextStatusAfterManagerApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'MANAGER_ONLY') return 'APPROVED'
  if (m === 'MANAGER_AND_COO') return 'PENDING_COO'
  return 'PENDING_GM'
}
function nextStatusAfterGmApprove(mode) {
  const m = normalizeMode(mode)
  if (m === 'GM_ONLY') return 'APPROVED'
  if (m === 'GM_AND_COO') return 'PENDING_COO'
  return 'APPROVED'
}
function nextStatusAfterCooApprove() {
  return 'APPROVED'
}

/* ───────────────── decision parsing ───────────────── */
function parseDecisionBody(req) {
  const body = req.body || {}
  const actionRaw = body.action || body.decision
  const note = s(body.note || body.comment || body.reason || '')
  const act = up(actionRaw)

  let action = ''
  if (act === 'APPROVE' || act === 'APPROVED') action = 'APPROVE'
  else if (act === 'REJECT' || act === 'REJECTED') action = 'REJECT'
  else throw createError(400, 'Invalid action')

  if (action === 'REJECT' && !note) throw createError(400, 'Reject requires a reason.')
  return { action, note }
}

/* ─────────────────────────────────────────────────────────────
   CREATE (LEAVE_USER)
   POST /api/leave/forget-scan
───────────────────────────────────────────────────────────── */
exports.createMyForgetScan = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')

    // resolve employeeId
    let empId = s(actor.employeeId)
    if (!empId) {
      // optional: if your EmployeeDirectory has loginId field
      const emp = await EmployeeDirectory.findOne({ loginId: s(actor.loginId) }, { employeeId: 1 }).lean()
      empId = s(emp?.employeeId)
      if (!empId) {
        const profByLogin = await LeaveProfile.findOne({ employeeLoginId: s(actor.loginId) }, { employeeId: 1 }).lean()
        empId = s(profByLogin?.employeeId)
      }
    }
    if (!empId) throw createError(400, 'Missing employeeId (cannot resolve from loginId)')

    const forgotDate = s(req.body?.forgotDate)
    if (!isValidYMD(forgotDate)) throw createError(400, 'forgotDate must be YYYY-MM-DD')

    const reason = s(req.body?.reason || '')
    const forgotTypes = normalizeForgotTypesFromBody(req.body)

    // profile
    let prof = await LeaveProfile.findOne({ employeeId: empId }).lean()
    if (!prof && actor.loginId) prof = await LeaveProfile.findOne({ employeeLoginId: s(actor.loginId) }).lean()
    if (!prof) throw createError(404, 'Leave profile not found')

    const mode = normalizeMode(prof.approvalMode)
    const managerLoginId = s(prof.managerLoginId)
    const gmLoginId = s(prof.gmLoginId)
    const cooLoginId = s(prof.cooLoginId)

    const approvals = buildApprovalsOrThrow(mode, { managerLoginId, gmLoginId, cooLoginId })
    const status = initialStatusForMode(mode)

    let doc
    try {
      doc = await ExpatForgetScanRequest.create({
        employeeId: empId,
        requesterLoginId: actor.loginId,

        forgotDate,
        forgotTypes,
        reason,

        approvalMode: mode,
        status,

        managerLoginId,
        gmLoginId,
        cooLoginId,

        approvals,
        attachments: [],
      })
    } catch (e) {
      if (e?.code === 11000) throw createError(409, 'You already submitted this forget scan request (same date and type set).')
      throw e
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:created')

    await safeNotify(notify?.notifyAdminsOnCreate, payload)
    await safeNotify(notify?.notifyForgetCreatedToEmployee, payload)
    await safeNotify(notify?.notifyCurrentApprover, payload)

    return res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   LIST MY (LEAVE_USER)
   GET /api/leave/forget-scan/my
───────────────────────────────────────────────────────────── */
exports.listMyForgetScans = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')

    const rows = await ExpatForgetScanRequest.find({ requesterLoginId: actor.loginId }).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GET ONE (VIEW: requester / approvers / admin)
   GET /api/leave/forget-scan/:id
───────────────────────────────────────────────────────────── */
exports.getOne = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId && !isAdminViewer(req)) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await ExpatForgetScanRequest.findById(id).lean()
    if (!doc) throw createError(404, 'Request not found')

    const canView =
      isAdminViewer(req) ||
      s(doc.requesterLoginId) === s(actor.loginId) ||
      actor.ids.includes(s(doc.managerLoginId)) ||
      actor.ids.includes(s(doc.gmLoginId)) ||
      actor.ids.includes(s(doc.cooLoginId))

    if (!canView) throw createError(403, 'Forbidden')

    const payload = await attachEmployeeInfoToOne(doc)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   UPDATE MY (LEAVE_USER) ✅ LOCK
   PATCH /api/leave/forget-scan/:id
───────────────────────────────────────────────────────────── */
exports.updateMyForgetScan = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await ExpatForgetScanRequest.findById(id)
    if (!doc) throw createError(404, 'Request not found')

    ensureOwner(doc, actor.loginId)

    const st = up(doc.status)
    if (!st.startsWith('PENDING')) throw createError(400, `Only pending requests can be edited. Current status: ${doc.status}`)

    ensureRequesterCanEditOrCancel(doc)

    const forgotDate = s(req.body?.forgotDate)
    if (!isValidYMD(forgotDate)) throw createError(400, 'forgotDate must be YYYY-MM-DD')

    const reason = s(req.body?.reason || '')
    const forgotTypes = normalizeForgotTypesFromBody(req.body)

    doc.forgotDate = forgotDate
    doc.forgotTypes = forgotTypes
    doc.reason = reason

    try {
      await doc.save()
    } catch (e) {
      if (e?.code === 11000) throw createError(409, 'You already submitted this forget scan request (same date and type set).')
      throw e
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   CANCEL MY (LEAVE_USER) ✅ LOCK
   POST /api/leave/forget-scan/:id/cancel
───────────────────────────────────────────────────────────── */
exports.cancelMyForgetScan = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')

    const { id } = req.params
    const doc = await ExpatForgetScanRequest.findById(id)
    if (!doc) throw createError(404, 'Request not found')

    if (!isAdminViewer(req)) ensureOwner(doc, actor.loginId)
    ensureRequesterCanEditOrCancel(doc)

    if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(up(doc.status))) {
      throw createError(400, `Request is ${doc.status}. Cannot cancel.`)
    }

    doc.status = 'CANCELLED'
    doc.cancelledAt = new Date()
    doc.cancelledBy = actor.loginId
    await doc.save()

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCancelledToEmployee, payload)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER INBOX ✅ includes MANAGER_ONLY
   GET /api/leave/forget-scan/manager/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewManagerInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const modeFilter = { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'] }

    const base = isAdminViewer(req) ? { approvalMode: modeFilter } : { approvalMode: modeFilter, managerLoginId: actor.loginId }

    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { ...base }
        : { ...base, status: 'PENDING_MANAGER' }
      : scope === 'ALL'
        ? { ...base, status: { $in: allowedStatusesForInboxLevel('MANAGER') } }
        : { ...base, status: 'PENDING_MANAGER' }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   MANAGER DECISION ✅ supports MANAGER_ONLY
   POST /api/leave/forget-scan/:id/manager-decision
───────────────────────────────────────────────────────────── */
exports.managerDecision = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require manager approval.')
    }

    if (s(existing.managerLoginId) !== actor.loginId) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_MANAGER') {
      throw createError(400, `Request is ${existing.status}. Manager can only decide when status is PENDING_MANAGER.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterManagerApprove(mode) : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            managerComment: s(note || ''),
            managerDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            managerComment: '',
            managerDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: actor.loginId,
            rejectedLevel: 'MANAGER',
          }

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_MANAGER', managerLoginId: actor.loginId },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'MANAGER', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyManagerDecisionToEmployee, payload)
    if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, payload)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM INBOX ✅ includes GM_ONLY + viewer MANAGER_ONLY
   GET /api/leave/forget-scan/gm/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listGmInbox = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewGmInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '')
    const actionableModes = ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY']
    const viewerMode = 'MANAGER_ONLY'

    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { approvalMode: { $in: [...actionableModes, viewerMode] } }
        : {
            $or: [
              { approvalMode: { $in: actionableModes }, status: 'PENDING_GM' },
              { approvalMode: viewerMode, status: 'PENDING_MANAGER' },
            ],
          }
      : scope === 'ALL'
        ? {
            $or: [
              {
                approvalMode: { $in: actionableModes },
                gmLoginId: actor.loginId,
                status: { $in: allowedStatusesForInboxLevel('GM') },
              },
              {
                approvalMode: viewerMode,
                status: { $in: allowedStatusesForInboxLevel('MANAGER') },
              },
            ],
          }
        : {
            $or: [
              { approvalMode: { $in: actionableModes }, gmLoginId: actor.loginId, status: 'PENDING_GM' },
              { approvalMode: viewerMode, status: 'PENDING_MANAGER' },
            ],
          }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   GM DECISION ✅ supports GM_ONLY
   POST /api/leave/forget-scan/:id/gm-decision
───────────────────────────────────────────────────────────── */
exports.gmDecision = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require GM approval.')
    }

    if (s(existing.gmLoginId) !== actor.loginId) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_GM') {
      throw createError(400, `Request is ${existing.status}. GM can only decide when status is PENDING_GM.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterGmApprove(mode) : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            gmComment: s(note || ''),
            gmDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            gmComment: '',
            gmDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: actor.loginId,
            rejectedLevel: 'GM',
          }

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_GM', gmLoginId: actor.loginId },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'GM', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyGmDecisionToEmployee, payload)
    if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, payload)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO INBOX
   ✅ viewerModes restricted to SAME cooLoginId (your requirement)
   GET /api/leave/forget-scan/coo/inbox?scope=ALL
───────────────────────────────────────────────────────────── */
exports.listCooInbox = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me && !isAdminViewer(req)) throw createError(400, 'Missing user identity')
    if (!canViewCooInbox(req)) throw createError(403, 'Forbidden')

    const scope = up(req.query?.scope || '') // 'ALL' or ''

    const actionableModes = ['MANAGER_AND_COO', 'GM_AND_COO', 'COO_ONLY']
    const viewerModes = ['GM_ONLY', 'MANAGER_ONLY']

    // ✅ IMPORTANT:
    // You requested viewerModes restricted to same cooLoginId.
    // That means: in GM_ONLY / MANAGER_ONLY, the LeaveProfile must still store cooLoginId,
    // and the request must store cooLoginId as well.
    const query = isAdminViewer(req)
      ? scope === 'ALL'
        ? { approvalMode: { $in: [...actionableModes, ...viewerModes] } }
        : {
            $or: [
              { approvalMode: { $in: actionableModes }, status: 'PENDING_COO' },
              { approvalMode: 'GM_ONLY', status: 'PENDING_GM' },
              { approvalMode: 'MANAGER_ONLY', status: 'PENDING_MANAGER' },
            ],
          }
      : scope === 'ALL'
        ? {
            $or: [
              {
                approvalMode: { $in: actionableModes },
                cooLoginId: me,
                status: { $in: allowedStatusesForInboxLevel('COO') },
              },
              {
                approvalMode: { $in: viewerModes },
                cooLoginId: me, // ✅ restricted to same COO
                status: { $in: ['PENDING_MANAGER', 'PENDING_GM', 'APPROVED', 'REJECTED', 'CANCELLED', 'PENDING_COO'] },
              },
            ],
          }
        : {
            $or: [
              { approvalMode: { $in: actionableModes }, cooLoginId: me, status: 'PENDING_COO' },
              { approvalMode: 'GM_ONLY', cooLoginId: me, status: 'PENDING_GM' },
              { approvalMode: 'MANAGER_ONLY', cooLoginId: me, status: 'PENDING_MANAGER' },
            ],
          }

    const rows = await ExpatForgetScanRequest.find(query).sort({ createdAt: -1 }).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   COO DECISION ✅ supports COO_ONLY + mismatch-safe
   POST /api/leave/forget-scan/:id/coo-decision
───────────────────────────────────────────────────────────── */
exports.cooDecision = async (req, res, next) => {
  try {
    const actor = getActor(req)
    if (!actor.loginId) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const myIds = actor.ids

    const { id } = req.params
    const { action, note } = parseDecisionBody(req)

    const existing = await ExpatForgetScanRequest.findById(id)
    if (!existing) throw createError(404, 'Request not found')

    const mode = normalizeMode(existing.approvalMode)
    if (!['MANAGER_AND_COO', 'GM_AND_COO', 'COO_ONLY'].includes(mode)) {
      throw createError(400, 'This request does not require COO approval.')
    }

    if (!myIds.includes(s(existing.cooLoginId))) throw createError(403, 'Not your request')
    if (s(existing.status) !== 'PENDING_COO') {
      throw createError(400, `Request is ${existing.status}. COO can only decide when status is PENDING_COO.`)
    }

    const now = new Date()
    const newStatus = action === 'APPROVE' ? nextStatusAfterCooApprove() : 'REJECTED'

    const setPayload =
      action === 'APPROVE'
        ? {
            status: newStatus,
            cooComment: s(note || ''),
            cooDecisionAt: now,
            rejectedReason: '',
            rejectedAt: null,
            rejectedBy: '',
            rejectedLevel: '',
          }
        : {
            status: 'REJECTED',
            cooComment: '',
            cooDecisionAt: now,
            rejectedReason: s(note),
            rejectedAt: now,
            rejectedBy: actor.loginId,
            rejectedLevel: 'COO',
          }

    const doc = await ExpatForgetScanRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING_COO', cooLoginId: { $in: myIds } },
      {
        $set: {
          ...setPayload,
          approvals: markApproval(existing.approvals, 'COO', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
        },
      },
      { new: true }
    )

    if (!doc) {
      const latest = await ExpatForgetScanRequest.findById(id).lean()
      throw createError(409, `Someone already decided this request (${latest?.status || 'UNKNOWN'}).`)
    }

    const payload = await attachEmployeeInfoToOne(doc)
    emitForget(req, payload, 'forgetscan:req:updated')

    await safeNotify(notify?.notifyAdminsOnUpdate, payload)
    await safeNotify(notify?.notifyCooDecisionToEmployee, payload)

    return res.json(payload)
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   ADMIN LIST (VIEW ONLY)
───────────────────────────────────────────────────────────── */
exports.adminList = async (req, res, next) => {
  try {
    if (!isAdminViewer(req)) throw createError(403, 'Forbidden')

    const employeeId = s(req.query?.employeeId)
    const status = up(req.query?.status)
    const from = s(req.query?.from)
    const to = s(req.query?.to)

    const limitRaw = Number(req.query?.limit || 200)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200

    const q = {}
    if (employeeId) q.employeeId = employeeId
    if (status) q.status = status

    if (isValidYMD(from) || isValidYMD(to)) {
      q.forgotDate = {}
      if (isValidYMD(from)) q.forgotDate.$gte = from
      if (isValidYMD(to)) q.forgotDate.$lte = to
    }

    const rows = await ExpatForgetScanRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean()
    return res.json(await attachEmployeeInfo(rows || []))
  } catch (e) {
    next(e)
  }
}

/* ─────────────────────────────────────────────────────────────
   BULK DECISIONS (same as Swap style)
───────────────────────────────────────────────────────────── */
exports.managerBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canManagerDecide(req)) throw createError(403, 'Forbidden')

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await ExpatForgetScanRequest.find({
      _id: { $in: ids },
      status: 'PENDING_MANAGER',
      managerLoginId: me,
      approvalMode: { $in: ['MANAGER_AND_GM', 'MANAGER_AND_COO', 'MANAGER_ONLY'] },
    })

    if (!docs.length) return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })

    const ops = docs.map((d) => {
      const mode = normalizeMode(d.approvalMode)
      const newStatus = action === 'APPROVE' ? nextStatusAfterManagerApprove(mode) : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              managerComment: s(note || ''),
              managerDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              managerComment: '',
              managerDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'MANAGER',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_MANAGER', managerLoginId: me },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'MANAGER', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await ExpatForgetScanRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await ExpatForgetScanRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitForget(req, p, 'forgetscan:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyManagerDecisionToEmployee, p)
      if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}

exports.gmBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canGmDecide(req)) throw createError(403, 'Forbidden')

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await ExpatForgetScanRequest.find({
      _id: { $in: ids },
      status: 'PENDING_GM',
      gmLoginId: me,
      approvalMode: { $in: ['MANAGER_AND_GM', 'GM_AND_COO', 'GM_ONLY'] },
    })

    if (!docs.length) return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })

    const ops = docs.map((d) => {
      const mode = normalizeMode(d.approvalMode)
      const newStatus = action === 'APPROVE' ? nextStatusAfterGmApprove(mode) : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              gmComment: s(note || ''),
              gmDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              gmComment: '',
              gmDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'GM',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_GM', gmLoginId: me },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'GM', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await ExpatForgetScanRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await ExpatForgetScanRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitForget(req, p, 'forgetscan:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyGmDecisionToEmployee, p)
      if (action === 'APPROVE') await safeNotify(notify?.notifyCurrentApprover, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}

exports.cooBulkDecision = async (req, res, next) => {
  try {
    const me = actorLoginId(req)
    if (!me) throw createError(400, 'Missing user identity')
    if (!canCooDecide(req)) throw createError(403, 'Forbidden')

    const myIds = actorIds(req)

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => s(x)).filter(Boolean) : []
    if (!ids.length) throw createError(400, 'ids is required')

    const { action, note } = parseDecisionBody(req)
    const now = new Date()

    const docs = await ExpatForgetScanRequest.find({
      _id: { $in: ids },
      status: 'PENDING_COO',
      cooLoginId: { $in: myIds },
      approvalMode: { $in: ['MANAGER_AND_COO', 'GM_AND_COO', 'COO_ONLY'] },
    })

    if (!docs.length) return res.json({ ok: true, total: ids.length, processed: 0, updated: [], skipped: ids })

    const ops = docs.map((d) => {
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'

      const setPayload =
        action === 'APPROVE'
          ? {
              status: newStatus,
              cooComment: s(note || ''),
              cooDecisionAt: now,
              rejectedReason: '',
              rejectedAt: null,
              rejectedBy: '',
              rejectedLevel: '',
            }
          : {
              status: 'REJECTED',
              cooComment: '',
              cooDecisionAt: now,
              rejectedReason: s(note),
              rejectedAt: now,
              rejectedBy: me,
              rejectedLevel: 'COO',
            }

      return {
        updateOne: {
          filter: { _id: d._id, status: 'PENDING_COO', cooLoginId: { $in: myIds } },
          update: {
            $set: {
              ...setPayload,
              approvals: markApproval(d.approvals, 'COO', action === 'APPROVE' ? 'APPROVED' : 'REJECTED', s(note || '')),
            },
          },
        },
      }
    })

    await ExpatForgetScanRequest.bulkWrite(ops, { ordered: false })

    const updatedDocs = await ExpatForgetScanRequest.find({ _id: { $in: docs.map((x) => x._id) } }).lean()
    const enriched = await attachEmployeeInfo(updatedDocs)

    for (const p of enriched) {
      emitForget(req, p, 'forgetscan:req:updated')
      await safeNotify(notify?.notifyAdminsOnUpdate, p)
      await safeNotify(notify?.notifyCooDecisionToEmployee, p)
    }

    return res.json({
      ok: true,
      total: ids.length,
      processed: enriched.length,
      updated: enriched,
      skipped: ids.filter((x) => !enriched.some((u) => String(u._id) === String(x))),
    })
  } catch (e) {
    next(e)
  }
}