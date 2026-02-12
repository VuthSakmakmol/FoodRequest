/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js
//
// ✅ Admin leave profile management (CLEAN VERSION)
// ✅ Only 3 approval modes:
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Concept (your requirement):
//    - Create profile creates ONLY employee account (User) + employee leave profile
//    - managerLoginId is OPTIONAL (manager may be created later)
//    - You can assign manager later in edit/update
//
// ✅ Password policy:
//    - If employee user exists -> OK (password optional)
//    - If employee user does NOT exist -> password REQUIRED, strong 13+
//
// ✅ Contracts-only carry:
//    - Carry stored ONLY in contracts[].carry
//    - Renew contract creates closeSnapshot + new contract + openSnapshot
//    - Default renew behavior: clear positive AL carry, keep negative AL carry

const bcrypt = require('bcryptjs')
const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/leave.realtime')

/* ───────────────── helpers ───────────────── */
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
function isValidYMD(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(x))
}
function ymdToUTCDate(ymd) {
  if (!isValidYMD(ymd)) return null
  const [y, m, d] = s(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

const APPROVAL_MODES = Object.freeze(['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'])

function normalizeApprovalMode(v) {
  if (typeof LeaveProfile?.normalizeApprovalMode === 'function') {
    return LeaveProfile.normalizeApprovalMode(v)
  }
  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  return 'MANAGER_AND_GM'
}

/**
 * ✅ IMPORTANT (your concept):
 * managerLoginId is OPTIONAL (manager may not exist yet).
 * Only validate the approvers required by the selected approvalMode.
 */
function validateModeApprovers(mode, { gmLoginId, cooLoginId }) {
  const m = normalizeApprovalMode(mode)

  if (m === 'MANAGER_AND_GM') {
    if (!s(gmLoginId)) throw createError(400, 'gmLoginId is required for MANAGER_AND_GM')
    return
  }
  if (m === 'MANAGER_AND_COO') {
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
 * - must include >= 3 of: upper, lower, number, special
 */
function validateStrongPassword(pwd) {
  const p = s(pwd)
  if (p.length < 13) return 'Password must be at least 13 characters.'
  const hasLower = /[a-z]/.test(p)
  const hasUpper = /[A-Z]/.test(p)
  const hasNum = /[0-9]/.test(p)
  const hasSym = /[^A-Za-z0-9]/.test(p)
  const score = [hasLower, hasUpper, hasNum, hasSym].filter(Boolean).length
  if (score < 3) return 'Password must include at least 3 of: lowercase, uppercase, number, special.'
  return ''
}

/**
 * ✅ Creates ONLY the employee account (User) when needed.
 * - If user exists -> return it (password not required)
 * - If missing -> password required (strong) and create account
 *
 * NOTE: Your EmployeeDirectory schema has NO loginId, only employeeId.
 * We will use EmployeeDirectory.findOne({ employeeId: loginId }) to fetch name.
 */
async function ensureUserAccount({ loginId, password }) {
  const login = s(loginId)
  if (!login) throw createError(400, 'employeeLoginId/loginId is required to create user account.')

  const existing = await User.findOne({ loginId: login })
  if (existing) return existing

  const pwd = s(password)
  if (!pwd) throw createError(400, 'Password is required to create a new user account.')

  const err = validateStrongPassword(pwd)
  if (err) throw createError(400, err)

  // get employee name from directory
  let name = ''
  try {
    const emp = await EmployeeDirectory.findOne({ employeeId: login }, { name: 1 }).lean()
    name = s(emp?.name)
  } catch {}
  if (!name) name = login

  const passwordHash = await bcrypt.hash(pwd, 10)

  // Only employee user role
  const user = await User.create({
    loginId: login,
    name,
    passwordHash,
    role: 'LEAVE_USER',
    roles: ['LEAVE_USER'],
    isActive: true,
  })

  return user
}

async function attachEmployeeDirectory(profilePlain) {
  const employeeId = s(profilePlain?.employeeId)
  if (!employeeId) return profilePlain

  const emp = await EmployeeDirectory.findOne(
    { employeeId },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  return {
    ...profilePlain,
    name: profilePlain?.name || s(emp?.name || ''),
    department: profilePlain?.department || s(emp?.department || ''),
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

function setPointersToLatest(profileDoc) {
  const latest = latestContract(profileDoc.contracts || [])
  if (!latest || !isValidYMD(latest.startDate)) return
  profileDoc.contractDate = s(latest.startDate)
  profileDoc.contractEndDate = isValidYMD(latest.endDate)
    ? s(latest.endDate)
    : contractEndFromStart(latest.startDate)
}

/**
 * Recompute balances from rules.js and save into profileDoc
 */
async function recomputeAndSaveBalances(profileDoc) {
  const employeeId = s(profileDoc.employeeId)

  const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()

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
   Returns: { gm:[{loginId,label}], coo:[{loginId,label}] }
───────────────────────────────────────────────────────────── */
exports.getApprovers = async (req, res) => {
  const gmUsers = await User.find(
    { roles: { $in: ['LEAVE_GM'] } },
    { loginId: 1, name: 1, username: 1 }
  ).sort({ loginId: 1 }).lean()

  const cooUsers = await User.find(
    { roles: { $in: ['LEAVE_COO'] } },
    { loginId: 1, name: 1, username: 1 }
  ).sort({ loginId: 1 }).lean()

  return res.json({
    gm: (gmUsers || []).map((u) => ({ loginId: s(u.loginId), label: s(u.name || u.username || u.loginId) })),
    coo: (cooUsers || []).map((u) => ({ loginId: s(u.loginId), label: s(u.name || u.username || u.loginId) })),
  })
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/grouped?includeInactive=true|false
   Group by managerLoginId (can be empty)
───────────────────────────────────────────────────────────── */
exports.getProfilesGrouped = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'
  const query = includeInactive ? {} : { isActive: true }

  const rows = await LeaveProfile.find(query, { __v: 0 }).sort({ employeeId: 1 }).lean()
  const enriched = await Promise.all((rows || []).map((p) => attachEmployeeDirectory(p)))

  const list = enriched.map((p) => ({
    ...p,
    approvalMode: normalizeApprovalMode(p.approvalMode),
  }))

  const map = new Map()
  for (const p of list) {
    const key = s(p.managerLoginId) || 'NO_MANAGER'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(p)
  }

  async function lookupManager(loginId) {
    const key = s(loginId)
    if (!key || key === 'NO_MANAGER') return null

    // We can only lookup by employeeId in your directory schema.
    const emp = await EmployeeDirectory.findOne(
      { employeeId: key },
      { employeeId: 1, name: 1, department: 1 }
    ).lean()

    if (!emp) return { loginId: key, employeeId: key, name: key, department: '' }
    return {
      loginId: key,
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
   Create SINGLE employee profile + create employee user account (only employee)
───────────────────────────────────────────────────────────── */
exports.createProfileSingle = async (req, res) => {
  const body = req.body || {}

  const employeeId = s(body.employeeId)
  if (!employeeId) throw createError(400, 'employeeId is required')

  const existing = await LeaveProfile.findOne({ employeeId })
  if (existing) throw createError(409, 'Leave profile already exists')

  // In your system: employeeLoginId = loginId for User
  const employeeLoginId = s(body.employeeLoginId || body.loginId || body.employeeId)
  if (!employeeLoginId) throw createError(400, 'employeeLoginId/loginId is required')

  const approvalMode = normalizeApprovalMode(body.approvalMode)
  const managerLoginId = s(body.managerLoginId) // ✅ optional
  const gmLoginId = s(body.gmLoginId)
  const cooLoginId = s(body.cooLoginId)

  validateModeApprovers(approvalMode, { gmLoginId, cooLoginId })

  // ✅ Create ONLY employee account (manager not touched)
  await ensureUserAccount({
    loginId: employeeLoginId,
    password: body.password,
  })

  const joinDate = s(body.joinDate)
  if (!isValidYMD(joinDate)) throw createError(400, 'joinDate must be YYYY-MM-DD')

  const contractDate = s(body.contractDate || joinDate)
  if (!isValidYMD(contractDate)) throw createError(400, 'contractDate must be YYYY-MM-DD')

  const endDate = contractEndFromStart(contractDate)
  const initialCarry = normalizeCarryObj(body.carry)

  const contracts = [
    {
      contractNo: 1,
      startDate: contractDate,
      endDate,
      carry: initialCarry,
      openedAt: new Date(),
      openedBy: s(req.user?.loginId || 'admin'),
      note: 'Initial contract',
      openSnapshot: {
        asOf: contractDate,
        contractDate,
        contractEndDate: endDate,
        carry: initialCarry,
        balances: [],
      },
      closeSnapshot: null,
    },
  ]

  const doc = await LeaveProfile.create({
    employeeId,
    employeeLoginId,
    managerLoginId, // ✅ optional
    gmLoginId,
    cooLoginId,
    approvalMode,
    joinDate,
    contractDate,
    contractEndDate: endDate,
    isActive: body.isActive === false ? false : true,
    contracts,
  })

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:created')

  const plain = await attachEmployeeDirectory(saved.toObject())
  plain.approvalMode = normalizeApprovalMode(plain.approvalMode)

  return res.status(201).json(plain)
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles/manager
   Bulk create employees (NO manager creation; managerLoginId optional string)
   body: { approvalMode, managerLoginId?, gmLoginId, cooLoginId?, employees:[...] }
───────────────────────────────────────────────────────────── */
exports.createManagerWithEmployees = async (req, res) => {
  const body = req.body || {}
  const approvalMode = normalizeApprovalMode(body.approvalMode)

  const managerLoginId = s(body.managerLoginId) // ✅ optional
  const gmLoginId = s(body.gmLoginId)
  const cooLoginId = s(body.cooLoginId)

  validateModeApprovers(approvalMode, { gmLoginId, cooLoginId })

  const employees = Array.isArray(body.employees) ? body.employees : []
  if (!employees.length) throw createError(400, 'employees[] is required')

  const created = []

  for (const e of employees) {
    const employeeId = s(e.employeeId)
    if (!employeeId) continue

    const exists = await LeaveProfile.findOne({ employeeId })
    if (exists) continue

    const employeeLoginId = s(e.employeeLoginId || e.loginId || employeeId)
    if (!employeeLoginId) throw createError(400, `employeeLoginId missing for employeeId=${employeeId}`)

    // ✅ Create ONLY employee account
    await ensureUserAccount({
      loginId: employeeLoginId,
      password: e.password,
    })

    const joinDate = s(e.joinDate)
    if (!isValidYMD(joinDate)) throw createError(400, `joinDate must be YYYY-MM-DD for employeeId=${employeeId}`)

    const contractDate = s(e.contractDate || joinDate)
    if (!isValidYMD(contractDate)) throw createError(400, `contractDate must be YYYY-MM-DD for employeeId=${employeeId}`)

    const endDate = contractEndFromStart(contractDate)
    const initialCarry = normalizeCarryObj(e.carry)

    const doc = await LeaveProfile.create({
      employeeId,
      employeeLoginId,
      managerLoginId, // ✅ optional
      gmLoginId,
      cooLoginId,
      approvalMode,
      joinDate,
      contractDate,
      contractEndDate: endDate,
      isActive: e.isActive === false ? false : true,
      contracts: [
        {
          contractNo: 1,
          startDate: contractDate,
          endDate,
          carry: initialCarry,
          openedAt: new Date(),
          openedBy: s(req.user?.loginId || 'admin'),
          note: 'Initial contract',
          openSnapshot: {
            asOf: contractDate,
            contractDate,
            contractEndDate: endDate,
            carry: initialCarry,
            balances: [],
          },
          closeSnapshot: null,
        },
      ],
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
   ✅ managerLoginId optional (can be set later when manager exists)
───────────────────────────────────────────────────────────── */
exports.updateProfile = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const body = req.body || {}

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const nextApprovalMode = normalizeApprovalMode(body.approvalMode ?? doc.approvalMode)
  const nextManager = s(body.managerLoginId ?? doc.managerLoginId) // optional
  const nextGm = s(body.gmLoginId ?? doc.gmLoginId)
  const nextCoo = s(body.cooLoginId ?? doc.cooLoginId)

  validateModeApprovers(nextApprovalMode, { gmLoginId: nextGm, cooLoginId: nextCoo })

  doc.approvalMode = nextApprovalMode
  doc.managerLoginId = nextManager
  doc.gmLoginId = nextGm
  doc.cooLoginId = nextCoo

  if (body.joinDate !== undefined) {
    if (body.joinDate && !isValidYMD(body.joinDate)) throw createError(400, 'joinDate must be YYYY-MM-DD')
    doc.joinDate = s(body.joinDate)
  }

  if (body.isActive !== undefined) doc.isActive = !!body.isActive

  if (body.name !== undefined) doc.name = s(body.name)
  if (body.department !== undefined) doc.department = s(body.department)
  if (body.employeeLoginId !== undefined) doc.employeeLoginId = s(body.employeeLoginId)

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

  return res.json({ employeeId, contracts: Array.isArray(doc.contracts) ? doc.contracts : [] })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId/contracts/:contractNo
   Update carry for a specific contract
───────────────────────────────────────────────────────────── */
exports.updateContractCarry = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const contractNo = Number(req.params.contractNo)
  if (!Number.isFinite(contractNo) || contractNo <= 0) throw createError(400, 'Invalid contractNo')

  const carry = normalizeCarryObj((req.body || {}).carry)

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const idx = (doc.contracts || []).findIndex((c) => Number(c.contractNo) === contractNo)
  if (idx < 0) throw createError(404, 'Contract not found')

  doc.contracts[idx].carry = carry
  if (doc.contracts[idx].openSnapshot) doc.contracts[idx].openSnapshot.carry = carry

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
───────────────────────────────────────────────────────────── */
exports.renewContract = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const { newContractDate, clearUnusedAL = true, note = '' } = req.body || {}

  if (!isValidYMD(newContractDate)) throw createError(400, 'newContractDate must be YYYY-MM-DD')

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  if (!Array.isArray(doc.contracts)) doc.contracts = []
  const latest = latestContract(doc.contracts)

  // Close snapshot of latest contract (if not closed)
  if (latest && !latest.closedAt) {
    const asOf = isValidYMD(latest.endDate) ? latest.endDate : s(doc.contractEndDate)
    const asOfDate = ymdToUTCDate(asOf) || new Date()

    const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' })
      .sort({ startDate: 1 })
      .lean()

    const snap = computeBalances(doc.toObject ? doc.toObject() : doc, approved, asOfDate)

    latest.closedAt = new Date()
    latest.closedBy = s(req.user?.loginId || '')
    latest.note = s(note || latest.note || '')

    latest.closeSnapshot = {
      asOf: asOf || s(snap?.meta?.asOfYMD || ''),
      contractDate: s(latest.startDate || doc.contractDate || ''),
      contractEndDate: s(latest.endDate || doc.contractEndDate || ''),
      carry: normalizeCarryObj(latest.carry),
      balances: Array.isArray(snap?.balances) ? snap.balances : [],
    }
  }

  // Determine AL carry into new contract:
  // - clearUnusedAL=true => keep negative only, clear positive
  // - clearUnusedAL=false => carry full remaining
  let alRemaining = 0
  try {
    const al = (doc.balances || []).find((b) => up(b.leaveTypeCode) === 'AL')
    alRemaining = num(al?.remaining)
  } catch {}

  const nextALCarry = clearUnusedAL ? (alRemaining < 0 ? alRemaining : 0) : alRemaining

  const nextContractNo = doc.contracts.length
    ? Math.max(...doc.contracts.map((c) => num(c.contractNo))) + 1
    : 1

  const endDate = contractEndFromStart(newContractDate)
  const newCarry = { AL: nextALCarry, SP: 0, MC: 0, MA: 0, UL: 0 }

  doc.contracts.push({
    contractNo: nextContractNo,
    startDate: s(newContractDate),
    endDate,
    carry: newCarry,
    openedAt: new Date(),
    openedBy: s(req.user?.loginId || ''),
    note: s(note || ''),
    openSnapshot: {
      asOf: s(newContractDate),
      contractDate: s(newContractDate),
      contractEndDate: endDate,
      carry: normalizeCarryObj(newCarry),
      balances: [],
    },
    closeSnapshot: null,
  })

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
   - Admin sets new password directly (no old password)
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

  user.passwordHash = await bcrypt.hash(s(password), 10)
  await user.save()

  return res.json({ ok: true, loginId })
}
