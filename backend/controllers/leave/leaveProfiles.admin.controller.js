/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js
//
// ✅ Admin leave profile management
// ✅ Enforces ONLY 3 approval modes everywhere:
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Password policy change (per Ant request):
//    - NO auto-generated password formula
//    - Admin MUST input password when creating profile (account creation step)
//    - Admin can reset password any time (no old password)
//
// ✅ Contract-aware carry:
//    - Each contract has its own carry
//    - Renew contract creates closeSnapshot + new contract
//    - Carry default behavior: clear positive AL on renew (but keep negative AL)

const bcrypt = require('bcryptjs')
const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/leave.realtime')

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const APPROVAL_MODES = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])

function normalizeApprovalMode(v) {
  // prefer model static if present
  if (typeof LeaveProfile?.normalizeApprovalMode === 'function') {
    return LeaveProfile.normalizeApprovalMode(v)
  }

  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  // legacy
  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'GM_OR_COO') return 'GM_AND_COO'
  if (raw === 'GM_COO') return 'GM_AND_COO'
  if (raw === 'COO_AND_GM') return 'GM_AND_COO'
  if (raw === 'GM_THEN_COO') return 'GM_AND_COO'

  return 'MANAGER_AND_GM'
}

function validateModeApprovers(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeApprovalMode(mode)

  if (m === 'MANAGER_AND_GM') {
    if (!s(managerLoginId)) throw createError(400, 'managerLoginId is required for MANAGER_AND_GM')
    if (!s(gmLoginId)) throw createError(400, 'gmLoginId is required for MANAGER_AND_GM')
    return
  }
  if (m === 'MANAGER_AND_COO') {
    if (!s(managerLoginId)) throw createError(400, 'managerLoginId is required for MANAGER_AND_COO')
    if (!s(cooLoginId)) throw createError(400, 'cooLoginId is required for MANAGER_AND_COO')
    return
  }
  if (m === 'GM_AND_COO') {
    if (!s(gmLoginId)) throw createError(400, 'gmLoginId is required for GM_AND_COO')
    if (!s(cooLoginId)) throw createError(400, 'cooLoginId is required for GM_AND_COO')
    return
  }

  throw createError(400, 'Invalid approvalMode')
}

function contractEndFromStart(startYMD) {
  // same logic as model: end = start + 1 year - 1 day (UTC-safe)
  const [y, m, d] = s(startYMD).split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCFullYear(dt.getUTCFullYear() + 1)
  dt.setUTCDate(dt.getUTCDate() - 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}

function normalizeCarryObj(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    AL: num(src.AL),
    SP: num(src.SP),
    MC: num(src.MC),
    MA: num(src.MA),
    UL: num(src.UL),
  }
}

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitProfile(req, docOrPlain, event = 'leave:profile:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastLeaveProfile(io, docOrPlain, event)
  } catch (e) {
    console.warn(`⚠️ realtime emitProfile(${event}) failed:`, e?.message)
  }
}

/**
 * Password policy:
 * - at least 13 chars
 * - must include upper, lower, number, special
 */
function validateStrongPassword(pwd) {
  const p = s(pwd)
  if (p.length < 13) return 'Password must be at least 13 characters.'
  if (!/[a-z]/.test(p)) return 'Password must include a lowercase letter.'
  if (!/[A-Z]/.test(p)) return 'Password must include an uppercase letter.'
  if (!/[0-9]/.test(p)) return 'Password must include a number.'
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must include a special character.'
  return ''
}

async function ensureUserAccount({ loginId, password, createdBy }) {
  const login = s(loginId)
  if (!login) throw createError(400, 'employeeLoginId/loginId is required to create user account.')

  const pwd = s(password)
  const err = validateStrongPassword(pwd)
  if (err) throw createError(400, err)

  const existing = await User.findOne({ loginId: login })
  if (existing) {
    // We do NOT auto-change password here (admin reset endpoint exists).
    return existing
  }

  const hash = await bcrypt.hash(pwd, 10)

  // NOTE: adapt to your User schema fields as needed.
  const user = await User.create({
    loginId: login,
    password: hash,
    role: 'LEAVE_USER',
    roles: ['LEAVE_USER'],
    createdBy: s(createdBy || ''),
  })

  return user
}

async function attachEmployeeDirectory(profilePlain) {
  const employeeId = s(profilePlain?.employeeId)
  if (!employeeId) return profilePlain

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    { employeeId: 1, name: 1, department: 1, loginId: 1 }
  ).lean()

  return {
    ...profilePlain,
    name: profilePlain?.name || emp?.name || '',
    department: profilePlain?.department || emp?.department || '',
    employeeLoginId: profilePlain?.employeeLoginId || s(emp?.loginId || ''),
  }
}

function latestContract(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts : []
  if (!arr.length) return null
  const withStart = arr.filter((c) => isValidYMD(c?.startDate))
  if (withStart.length) {
    return withStart.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  }
  return arr.slice().sort((a, b) => num(b.contractNo) - num(a.contractNo))[0]
}

function setPointersToLatest(profile) {
  const latest = latestContract(profile.contracts || [])
  if (!latest || !isValidYMD(latest.startDate)) return
  profile.contractDate = latest.startDate
  profile.contractEndDate = isValidYMD(latest.endDate) ? latest.endDate : contractEndFromStart(latest.startDate)
}

async function recomputeAndSaveBalances(profileDoc) {
  const employeeId = s(profileDoc.employeeId)
  const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' }).sort({ startDate: 1 }).lean()

  const snap = computeBalances(profileDoc.toObject ? profileDoc.toObject() : profileDoc, approved, new Date())
  const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
  const nextAsOf = s(snap?.meta?.asOfYMD || profileDoc.balancesAsOf || '')
  const nextEnd = s(snap?.meta?.contractYear?.endDate || profileDoc.contractEndDate || '')

  profileDoc.balances = nextBalances
  if (nextAsOf) profileDoc.balancesAsOf = nextAsOf
  if (nextEnd) profileDoc.contractEndDate = nextEnd

  await profileDoc.save()
  return profileDoc
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/approvers
   Returns candidates for dropdowns
───────────────────────────────────────────────────────────── */
exports.getApprovers = async (req, res) => {
  const gmUsers = await User.find(
    { roles: { $in: ['LEAVE_GM'] } },
    { loginId: 1, name: 1, username: 1 }
  )
    .sort({ loginId: 1 })
    .lean()

  const cooUsers = await User.find(
    { roles: { $in: ['LEAVE_COO'] } },
    { loginId: 1, name: 1, username: 1 }
  )
    .sort({ loginId: 1 })
    .lean()

  return res.json({
    gm: (gmUsers || []).map((u) => ({ loginId: s(u.loginId), label: s(u.name || u.username || u.loginId) })),
    coo: (cooUsers || []).map((u) => ({ loginId: s(u.loginId), label: s(u.name || u.username || u.loginId) })),
  })
}

/* GET /admin/leave/profiles/grouped?includeInactive=true|false */
exports.getProfilesGrouped = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'

  const query = includeInactive ? {} : { isActive: true }

  const rows = await LeaveProfile.find(query, { __v: 0 }).sort({ employeeId: 1 }).lean()
  const enriched = await Promise.all((rows || []).map((p) => attachEmployeeDirectory(p)))

  const list = enriched.map((p) => ({
    ...p,
    approvalMode: normalizeApprovalMode(p.approvalMode),
  }))

  // group by managerLoginId (or NO_MANAGER)
  const map = new Map()
  for (const p of list) {
    const key = s(p.managerLoginId) || 'NO_MANAGER'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(p)
  }

  // lookup manager info from EmployeeDirectory by loginId (if you store it)
  async function lookupManager(loginId) {
    const key = s(loginId)
    if (!key || key === 'NO_MANAGER') return null
    const emp = await EmployeeDirectory.findOne(
      { loginId: key },
      { employeeId: 1, name: 1, department: 1, loginId: 1 }
    ).lean()
    if (!emp) return { loginId: key, employeeId: '', name: key, department: '' }
    return {
      loginId: s(emp.loginId),
      employeeId: s(emp.employeeId),
      name: s(emp.name),
      department: s(emp.department),
    }
  }

  const entries = [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  const out = []
  for (const [managerLoginId, profiles] of entries) {
    const manager = await lookupManager(managerLoginId)
    out.push({
      managerLoginId,
      manager,
      employees: profiles.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId))),
    })
  }

  return res.json(out)
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/:employeeId
───────────────────────────────────────────────────────────── */
exports.getProfileOne = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const plain = await attachEmployeeDirectory(doc.toObject())
  plain.approvalMode = normalizeApprovalMode(plain.approvalMode)

  return res.json(plain)
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles
   Create single profile + create user account (admin must input password)
   body: {
     employeeId, employeeLoginId,
     managerLoginId, gmLoginId, cooLoginId,
     approvalMode,
     joinDate, contractDate, isActive,
     password
   }
───────────────────────────────────────────────────────────── */
exports.createProfileSingle = async (req, res) => {
  const body = req.body || {}

  const employeeId = s(body.employeeId)
  if (!employeeId) throw createError(400, 'employeeId is required')

  // prevent duplicate
  const existing = await LeaveProfile.findOne({ employeeId })
  if (existing) throw createError(409, 'Leave profile already exists')

  const employeeLoginId = s(body.employeeLoginId || body.loginId)
  if (!employeeLoginId) throw createError(400, 'employeeLoginId/loginId is required')

  const approvalMode = normalizeApprovalMode(body.approvalMode)
  const managerLoginId = s(body.managerLoginId)
  const gmLoginId = s(body.gmLoginId)
  const cooLoginId = s(body.cooLoginId)

  validateModeApprovers(approvalMode, { managerLoginId, gmLoginId, cooLoginId })

  // ✅ Create user (admin MUST input password)
  await ensureUserAccount({
    loginId: employeeLoginId,
    password: body.password,
    createdBy: s(req.user?.loginId || ''),
  })

  const joinDate = s(body.joinDate)
  const contractDate = s(body.contractDate || joinDate)

  const doc = await LeaveProfile.create({
    employeeId,
    employeeLoginId,

    managerLoginId,
    gmLoginId,
    cooLoginId,

    approvalMode,

    joinDate,
    contractDate: contractDate || '',
    contractEndDate: isValidYMD(contractDate) ? contractEndFromStart(contractDate) : '',

    isActive: body.isActive === false ? false : true,

    // contracts will be auto-initialized by model pre-validate if empty
    contracts: Array.isArray(body.contracts) ? body.contracts : [],
  })

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:created')

  const plain = await attachEmployeeDirectory(saved.toObject())
  plain.approvalMode = normalizeApprovalMode(plain.approvalMode)

  return res.status(201).json(plain)
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles/manager
   Bulk create: manager + employees
   body: {
     managerEmployeeId? (optional for your old UI),
     managerLoginId,
     gmLoginId, cooLoginId,
     approvalMode,
     employees: [
       { employeeId, employeeLoginId, joinDate, contractDate, isActive, password, carry? }
     ]
   }
───────────────────────────────────────────────────────────── */
exports.createManagerWithEmployees = async (req, res) => {
  const body = req.body || {}
  const approvalMode = normalizeApprovalMode(body.approvalMode)

  const managerLoginId = s(body.managerLoginId)
  const gmLoginId = s(body.gmLoginId)
  const cooLoginId = s(body.cooLoginId)

  validateModeApprovers(approvalMode, { managerLoginId, gmLoginId, cooLoginId })

  const employees = Array.isArray(body.employees) ? body.employees : []
  if (!employees.length) throw createError(400, 'employees[] is required')

  // ✅ require password per employee
  const missingPw = employees
    .filter((e) => !s(e?.password))
    .map((e) => s(e?.employeeId || e?.employeeLoginId || 'UNKNOWN'))
  if (missingPw.length) {
    throw createError(400, `Missing password for employees: ${missingPw.join(', ')}`)
  }

  const created = []

  for (const e of employees) {
    const employeeId = s(e.employeeId)
    const employeeLoginId = s(e.employeeLoginId || e.loginId)

    if (!employeeId) continue
    if (!employeeLoginId) throw createError(400, `employeeLoginId missing for employeeId=${employeeId}`)

    const exists = await LeaveProfile.findOne({ employeeId })
    if (exists) continue // skip duplicates (safe)

    await ensureUserAccount({
      loginId: employeeLoginId,
      password: e.password,
      createdBy: s(req.user?.loginId || ''),
    })

    const joinDate = s(e.joinDate)
    const contractDate = s(e.contractDate || joinDate)

    // allow initial carry to be set into first contract by providing legacy carry at root
    const carry = normalizeCarryObj(e.carry)

    const doc = await LeaveProfile.create({
      employeeId,
      employeeLoginId,

      managerLoginId,
      gmLoginId,
      cooLoginId,

      approvalMode,

      joinDate,
      contractDate: contractDate || '',
      contractEndDate: isValidYMD(contractDate) ? contractEndFromStart(contractDate) : '',

      isActive: e.isActive === false ? false : true,

      // legacy carry -> model will migrate into first contract
      carry,
    })

    const saved = await recomputeAndSaveBalances(doc)
    emitProfile(req, saved, 'leave:profile:created')

    created.push(await attachEmployeeDirectory(saved.toObject()))
  }

  return res.json({ ok: true, createdCount: created.length, created })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId
   Update profile settings (mode + approvers + joinDate + active)
───────────────────────────────────────────────────────────── */
exports.updateProfile = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const body = req.body || {}

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  // allow updating these safely
  const nextApprovalMode = normalizeApprovalMode(body.approvalMode ?? doc.approvalMode)

  const nextManager = s(body.managerLoginId ?? doc.managerLoginId)
  const nextGm = s(body.gmLoginId ?? doc.gmLoginId)
  const nextCoo = s(body.cooLoginId ?? doc.cooLoginId)

  validateModeApprovers(nextApprovalMode, {
    managerLoginId: nextManager,
    gmLoginId: nextGm,
    cooLoginId: nextCoo,
  })

  doc.approvalMode = nextApprovalMode
  doc.managerLoginId = nextManager
  doc.gmLoginId = nextGm
  doc.cooLoginId = nextCoo

  if (body.joinDate !== undefined) doc.joinDate = s(body.joinDate)
  if (body.contractDate !== undefined) doc.contractDate = s(body.contractDate)
  if (body.isActive !== undefined) doc.isActive = !!body.isActive

  // optional meta
  if (body.name !== undefined) doc.name = s(body.name)
  if (body.department !== undefined) doc.department = s(body.department)
  if (body.employeeLoginId !== undefined) doc.employeeLoginId = s(body.employeeLoginId)

  // keep pointers aligned to latest contract (model pre-validate will also do this)
  setPointersToLatest(doc)

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  const plain = await attachEmployeeDirectory(saved.toObject())
  plain.approvalMode = normalizeApprovalMode(plain.approvalMode)

  return res.json(plain)
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/leave/profiles/:employeeId
   Deactivate (soft)
───────────────────────────────────────────────────────────── */
exports.deactivateProfile = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  doc.isActive = false
  await doc.save()

  emitProfile(req, doc, 'leave:profile:updated')
  return res.json({ ok: true, employeeId, isActive: false })
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/:employeeId/contracts
───────────────────────────────────────────────────────────── */
exports.getContractHistory = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const doc = await LeaveProfile.findOne({ employeeId }).lean()
  if (!doc) throw createError(404, 'Profile not found')

  const contracts = Array.isArray(doc.contracts) ? doc.contracts : []
  return res.json({ employeeId, contracts })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId/contracts/:contractNo
   Update carry for a specific contract
   body: { carry: {AL,SP,MC,MA,UL} }
───────────────────────────────────────────────────────────── */
exports.updateContractCarry = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const contractNo = Number(req.params.contractNo)
  if (!Number.isFinite(contractNo) || contractNo <= 0) throw createError(400, 'Invalid contractNo')

  const body = req.body || {}
  const carry = normalizeCarryObj(body.carry)

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const idx = (doc.contracts || []).findIndex((c) => Number(c.contractNo) === contractNo)
  if (idx < 0) throw createError(404, 'Contract not found')

  doc.contracts[idx].carry = carry
  doc.contracts[idx].alCarry = num(carry.AL)

  // align pointers
  setPointersToLatest(doc)

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  return res.json({
    ok: true,
    employeeId,
    contractNo,
    carry: saved.contracts[idx].carry,
  })
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles/:employeeId/contracts/renew
   body: { newContractDate, clearUnusedAL?: boolean, note?: string }
───────────────────────────────────────────────────────────── */
exports.renewContract = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const { newContractDate, clearUnusedAL = true, note = '' } = req.body || {}

  if (!isValidYMD(newContractDate)) throw createError(400, 'newContractDate must be YYYY-MM-DD')

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  if (!Array.isArray(doc.contracts)) doc.contracts = []
  const latest = latestContract(doc.contracts)

  // close latest contract (snapshot)
  if (latest && !latest.closedAt) {
    // snapshot as of contract end date (or today if missing)
    const asOf = isValidYMD(latest.endDate) ? latest.endDate : s(doc.contractEndDate)

    const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' }).sort({ startDate: 1 }).lean()
    const snap = computeBalances(doc.toObject ? doc.toObject() : doc, approved, new Date())

    latest.closedAt = new Date()
    latest.closedBy = s(req.user?.loginId || '')
    latest.note = s(note || latest.note || '')
    latest.closeSnapshot = {
      asOf: asOf || s(snap?.meta?.asOfYMD || ''),
      balances: Array.isArray(snap?.balances) ? snap.balances : [],
      contractDate: s(latest.startDate || doc.contractDate || ''),
      contractEndDate: s(latest.endDate || doc.contractEndDate || ''),
      carry: normalizeCarryObj(latest.carry),
    }
  }

  // determine AL carry into new contract:
  // - if clearUnusedAL: keep negative remaining only, clear positive
  // - else: carry full remaining (including positive)
  let alRemaining = 0
  try {
    const al = (doc.balances || []).find((b) => up(b.leaveTypeCode) === 'AL')
    alRemaining = num(al?.remaining)
  } catch {}

  const nextALCarry = clearUnusedAL ? (alRemaining < 0 ? alRemaining : 0) : alRemaining

  const nextContractNo = doc.contracts.length
    ? Math.max(...doc.contracts.map((c) => num(c.contractNo))) + 1
    : 1

  doc.contracts.push({
    contractNo: nextContractNo,
    startDate: s(newContractDate),
    endDate: contractEndFromStart(newContractDate),
    carry: { AL: nextALCarry, SP: 0, MC: 0, MA: 0, UL: 0 },
    alCarry: nextALCarry,
    openedAt: new Date(),
    openedBy: s(req.user?.loginId || ''),
    note: s(note || ''),
    closeSnapshot: null,
  })

  // align pointers to latest contract
  setPointersToLatest(doc)

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  return res.json({
    ok: true,
    employeeId,
    contractDate: saved.contractDate,
    contractEndDate: saved.contractEndDate,
    contracts: saved.contracts,
  })
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles/:employeeId/recalculate
───────────────────────────────────────────────────────────── */
exports.recalculateBalances = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  return res.json({ ok: true, employeeId, balances: saved.balances, balancesAsOf: saved.balancesAsOf })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId/password
   body: { password }
   - Admin can set new password directly (no old password)
───────────────────────────────────────────────────────────── */
exports.resetUserPassword = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const { password } = req.body || {}

  const prof = await LeaveProfile.findOne({ employeeId }).lean()
  if (!prof) throw createError(404, 'Profile not found')

  const loginId = s(prof.employeeLoginId)
  if (!loginId) throw createError(400, 'Profile missing employeeLoginId')

  const err = validateStrongPassword(password)
  if (err) throw createError(400, err)

  const user = await User.findOne({ loginId })
  if (!user) throw createError(404, 'User account not found for this profile')

  user.password = await bcrypt.hash(s(password), 10)
  await user.save()

  return res.json({ ok: true, loginId })
}
