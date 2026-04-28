/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js
//
// ✅ Admin leave profile management
// ✅ Approval modes:
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//    - MANAGER_ONLY
//    - GM_ONLY
//    - COO_ONLY
//
// ✅ Fixed approvers concept:
//    - GM  = leave_gm
//    - COO = leave_coo
//    => Admin DOES NOT need to type GM/COO IDs
//    => Still stored in profile so Telegram FYI / approver routing works.
//
// ✅ Manager requirement:
//    - For modes involving manager: managerLoginId IS REQUIRED
//
// ✅ FYI rules:
//    - MANAGER_ONLY: GM stored = leave_gm (FYI read-only)
//    - GM_ONLY: COO stored = leave_coo (FYI read-only)
//
// ✅ Contracts-only carry (contracts[].carry only)
// ✅ RAW balances stored in DB
// ✅ Carry applied only for response display
//
// ✅ NEW:
//    - exports.getMyProfile for /leave/profile/me
//    - shared buildProfileResponseByEmployeeId()
//    - same profile response shape for admin and user

const bcrypt = require('bcryptjs')
const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/leave.realtime')
const { recalculateOneProfile } = require('../../services/leave/leave.recalculate.service')

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

const FIXED = Object.freeze({
  GM_LOGIN_ID: 'leave_gm',
  COO_LOGIN_ID: 'leave_coo',
})

const APPROVAL_MODES = Object.freeze([
  'MANAGER_AND_GM',
  'MANAGER_AND_COO',
  'GM_AND_COO',
  'MANAGER_ONLY',
  'GM_ONLY',
  'COO_ONLY',
])

function normalizeApprovalMode(v) {
  if (typeof LeaveProfile?.normalizeApprovalMode === 'function') {
    return LeaveProfile.normalizeApprovalMode(v)
  }
  const raw = up(v)
  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'
  if (raw === 'MANAGER_ONLY') return 'MANAGER_ONLY'
  if (raw === 'GM_ONLY') return 'GM_ONLY'
  if (raw === 'COO_ONLY') return 'COO_ONLY'
  return 'MANAGER_AND_GM'
}

function modeInvolvesManager(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO' || mode === 'MANAGER_ONLY'
}
function modeInvolvesGm(mode) {
  return mode === 'MANAGER_AND_GM' || mode === 'GM_AND_COO' || mode === 'GM_ONLY' || mode === 'MANAGER_ONLY'
}
function modeInvolvesCoo(mode) {
  return mode === 'MANAGER_AND_COO' || mode === 'GM_AND_COO' || mode === 'COO_ONLY' || mode === 'GM_ONLY'
}

function validateModeApprovers(mode, { managerLoginId, gmLoginId, cooLoginId }) {
  const m = normalizeApprovalMode(mode)

  const manager = s(managerLoginId)
  const gm = s(gmLoginId)
  const coo = s(cooLoginId)

  if (m === 'MANAGER_AND_GM' || m === 'MANAGER_AND_COO' || m === 'MANAGER_ONLY') {
    if (!manager) throw createError(400, 'managerLoginId is required for this approval mode')
  }

  if (m === 'MANAGER_ONLY') {
    if (!gm) throw createError(400, 'gmLoginId is required for MANAGER_ONLY (FYI)')
    return
  }

  if (m === 'GM_ONLY') {
    if (!gm) throw createError(400, 'gmLoginId is required for GM_ONLY')
    if (!coo) throw createError(400, 'cooLoginId is required for GM_ONLY (FYI)')
    return
  }

  if (m === 'COO_ONLY') {
    if (!coo) throw createError(400, 'cooLoginId is required for COO_ONLY')
    return
  }

  if (m === 'MANAGER_AND_GM') {
    if (!gm) throw createError(400, 'gmLoginId is required for MANAGER_AND_GM')
    return
  }
  if (m === 'MANAGER_AND_COO') {
    if (!coo) throw createError(400, 'cooLoginId is required for MANAGER_AND_COO')
    return
  }
  if (m === 'GM_AND_COO') {
    if (!gm) throw createError(400, 'gmLoginId is required for GM_AND_COO')
    if (!coo) throw createError(400, 'cooLoginId is required for GM_AND_COO')
    return
  }

  throw createError(400, 'Invalid approvalMode')
}

async function ensureManagerRole(managerLoginId) {
  const id = s(managerLoginId)
  if (!id) return
  await ensureUserHasRoles(id, ['LEAVE_MANAGER'])
}

async function profileIsReferencedAsManager({ employeeId, employeeLoginId }) {
  const candidates = [...new Set([s(employeeId), s(employeeLoginId)].filter(Boolean))]
  if (!candidates.length) return false

  const found = await LeaveProfile.findOne({
    managerLoginId: { $in: candidates },
  }).lean()

  return !!found
}

async function syncUserRolesForProfile(profileLike) {
  const employeeId = s(profileLike?.employeeId)
  const employeeLoginId = s(profileLike?.employeeLoginId)

  if (!employeeLoginId) return null

  const roles = ['LEAVE_USER']

  const isManager = await profileIsReferencedAsManager({ employeeId, employeeLoginId })
  if (isManager) roles.push('LEAVE_MANAGER')

  return ensureUserHasRoles(employeeLoginId, roles)
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

function nextDayYMD(ymd) {
  if (!isValidYMD(ymd)) return ''
  const dt = ymdToUTCDate(ymd)
  if (!dt) return ''
  dt.setUTCDate(dt.getUTCDate() + 1)
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

async function ensureUserHasRoles(loginId, addRoles = []) {
  const login = s(loginId)
  const rolesToAdd = [...new Set((addRoles || []).map((r) => up(r)).filter(Boolean))]
  if (!login || !rolesToAdd.length) return null

  const user = await User.findOne({ loginId: login })
  if (!user) return null

  const current = []
  if (Array.isArray(user.roles)) current.push(...user.roles)
  if (user.role) current.push(user.role)

  const merged = [...new Set([...current.map(up), ...rolesToAdd])].filter(Boolean)

  const priority = ['ADMIN', 'LEAVE_ADMIN', 'LEAVE_COO', 'LEAVE_GM', 'LEAVE_MANAGER', 'LEAVE_USER']
  const primary =
    merged.slice().sort((a, b) => priority.indexOf(a) - priority.indexOf(b))[0] || 'LEAVE_USER'

  user.roles = merged
  user.role = primary
  await user.save()
  return user
}

async function ensureManagerRole(managerLoginId) {
  const id = s(managerLoginId)
  if (!id) return
  await ensureUserHasRoles(id, ['LEAVE_MANAGER'])
}

async function ensureUserAccount({ loginId, employeeId, password }) {
  const login = s(loginId)
  const empId = s(employeeId)

  if (!login) throw createError(400, 'loginId is required')
  if (!empId) throw createError(400, 'employeeId is required. User account cannot be saved without employeeId.')

  // 1) Find existing user by loginId first
  let existing = await User.findOne({ loginId: login })

  // 2) If not found by loginId, try find by employeeId
  if (!existing) {
    existing = await User.findOne({ employeeId: empId })
  }

  // 3) If existing user found, make sure employeeId is saved correctly
  if (existing) {
    const existingEmployeeId = s(existing.employeeId)

    // If this login belongs to another employee, block it
    if (existingEmployeeId && existingEmployeeId !== empId) {
      throw createError(
        409,
        `User loginId ${login} already belongs to employeeId ${existingEmployeeId}`
      )
    }

    // Fix old bad data: employeeId was empty before
    if (!existingEmployeeId) {
      existing.employeeId = empId
      await existing.save()
    }

    return existing
  }

  const pwd = s(password)
  if (!pwd) throw createError(400, 'Password is required to create a new user account.')

  const err = validateStrongPassword(pwd)
  if (err) throw createError(400, err)

  let name = ''
  try {
    const emp = await EmployeeDirectory.findOne(
      { employeeId: empId },
      { name: 1, fullName: 1 }
    ).lean()

    name = s(emp?.name || emp?.fullName)
  } catch {}

  if (!name) name = login

  const passwordHash = await bcrypt.hash(pwd, 10)

  const user = await User.create({
    loginId: login,
    employeeId: empId, // ✅ IMPORTANT: never save without employeeId
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
    {
      employeeId: 1,
      name: 1,
      fullName: 1,
      department: 1,
      position: 1,
      jobTitle: 1,
      title: 1,
      contactNumber: 1,
      telegramChatId: 1,
      loginId: 1,
      isActive: 1,
    }
  ).lean()

  const name = s(profilePlain?.name || emp?.name || emp?.fullName || '')
  const department = s(profilePlain?.department || emp?.department || '')
  const position = s(profilePlain?.position || emp?.position || emp?.jobTitle || emp?.title || '')
  const contactNumber = s(profilePlain?.contactNumber || emp?.contactNumber || '')
  const telegramChatId = s(profilePlain?.telegramChatId || emp?.telegramChatId || '')

  return {
    ...profilePlain,
    name,
    department,
    position,
    contactNumber,
    telegramChatId,
    employee: emp
      ? {
          employeeId: s(emp.employeeId),
          loginId: s(emp.loginId),
          name: s(emp.name || emp.fullName || ''),
          department: s(emp.department || ''),
          position: s(emp.position || emp.jobTitle || emp.title || ''),
          contactNumber: s(emp.contactNumber || ''),
          telegramChatId: s(emp.telegramChatId || ''),
          isActive: emp.isActive !== false,
        }
      : null,
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

function applyCarryToBalancesForDisplay(balances = [], carry = {}) {
  const carryObj = normalizeCarryObj(carry)
  const byCode = new Map(Object.entries(carryObj).map(([k, v]) => [up(k), num(v)]))

  return (Array.isArray(balances) ? balances : []).map((row) => {
    const code = up(row?.leaveTypeCode)
    const yearlyEntitlement = num(row?.yearlyEntitlement)
    const used = num(row?.used)
    const remaining = num(row?.remaining)

    const carryValue = num(byCode.get(code) ?? 0)
    const extraUsedFromCarry = carryValue < 0 ? Math.abs(carryValue) : 0
    const nextRemaining = remaining + carryValue

    return {
      ...row,
      yearlyEntitlement,
      used: used + extraUsedFromCarry,
      remaining: code === 'UL' ? Math.max(0, nextRemaining) : nextRemaining,
    }
  })
}

function decorateProfileForResponse(profilePlain = {}) {
  const latest = latestContract(profilePlain?.contracts || [])
  const activeCarry = normalizeCarryObj(latest?.carry || {})

  return {
    ...profilePlain,
    approvalMode: normalizeApprovalMode(profilePlain?.approvalMode),
    carry: activeCarry,
    currentContractStartDate: s(profilePlain?.contractDate || latest?.startDate || ''),
    currentContractEndDate: s(profilePlain?.contractEndDate || latest?.endDate || ''),
    balances: applyCarryToBalancesForDisplay(profilePlain?.balances || [], activeCarry),
  }
}

async function recomputeAndSaveBalances(profileDoc) {
  return recalculateOneProfile(profileDoc, {
    asOfDate: new Date(),
    save: true,
    log: false,
  })
}

/* ───────────────── shared profile resolver ───────────────── */
async function resolveEmployeeIdFromReq(req) {
  const loginId = s(req.user?.loginId)
  const directEmployeeId =
    s(req.user?.employeeId) ||
    s(req.auth?.employeeId) ||
    s(req.headers['x-employee-id'])

  if (directEmployeeId) return directEmployeeId

  if (loginId) {
    const byProfileLogin = await LeaveProfile.findOne(
      { employeeLoginId: loginId },
      { employeeId: 1 }
    ).lean()
    if (byProfileLogin?.employeeId) return s(byProfileLogin.employeeId)

    const byUser = await User.findOne(
      { loginId },
      { employeeId: 1, loginId: 1 }
    ).lean()
    if (byUser?.employeeId) return s(byUser.employeeId)

    const byDirectory = await EmployeeDirectory.findOne(
      { $or: [{ employeeId: loginId }, { loginId }] },
      { employeeId: 1 }
    ).lean()
    if (byDirectory?.employeeId) return s(byDirectory.employeeId)
  }

  return ''
}

async function buildProfileResponseByEmployeeId(employeeId) {
  const id = s(employeeId)
  if (!id) throw createError(400, 'employeeId is required')

  const doc = await LeaveProfile.findOne({ employeeId: id })
  if (!doc) throw createError(404, 'Profile not found')

  let plain = await attachEmployeeDirectory(doc.toObject())
  plain = decorateProfileForResponse(plain)
  return plain
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/modes
───────────────────────────────────────────────────────────── */
exports.getApprovalModes = async (req, res) => {
  return res.json({ ok: true, modes: APPROVAL_MODES })
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/grouped?includeInactive=true|false
───────────────────────────────────────────────────────────── */
exports.getProfilesGrouped = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'
  const q = s(req.query.q).toLowerCase()
  const page = Math.max(1, num(req.query.page) || 1)
  const pageSize = Math.max(1, Math.min(1000, num(req.query.pageSize) || 10))

  const baseQuery = includeInactive ? {} : { isActive: true }

  const rows = await LeaveProfile.find(baseQuery, { __v: 0 })
    .sort({ employeeId: 1 })
    .lean()

  const enriched = await Promise.all((rows || []).map((p) => attachEmployeeDirectory(p)))

  const normalized = enriched.map((p) =>
    decorateProfileForResponse({
      ...p,
      approvalMode: normalizeApprovalMode(p.approvalMode),
    })
  )

  const filtered = normalized.filter((p) => {
    if (!q) return true

    const hay = [
      p.employeeId,
      p.name,
      p.department,
      p.position,
      p.managerLoginId,
      p.gmLoginId,
      p.cooLoginId,
      p.approvalMode,
      p.employeeLoginId,
      p.contractDate,
      p.contractEndDate,
      p.joinDate,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return hay.includes(q)
  })

  const totalRows = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pageRows = filtered.slice(start, start + pageSize)

  async function lookupManager(loginId) {
    const key = s(loginId)
    if (!key || key === 'NO_MANAGER') return null

    const emp = await EmployeeDirectory.findOne(
      { employeeId: key },
      { employeeId: 1, name: 1, fullName: 1, department: 1 }
    ).lean()

    if (!emp) {
      return {
        loginId: key,
        employeeId: key,
        name: key,
        department: '',
      }
    }

    return {
      loginId: key,
      employeeId: s(emp.employeeId),
      name: s(emp.name || emp.fullName || ''),
      department: s(emp.department),
    }
  }

  const map = new Map()
  for (const p of pageRows) {
    const key = s(p.managerLoginId) || 'NO_MANAGER'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(p)
  }

  const entries = [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  const groups = []
  for (const [managerLoginId, employees] of entries) {
    const manager = await lookupManager(managerLoginId)
    groups.push({
      managerLoginId,
      manager,
      employees: employees.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId))),
    })
  }

  return res.json({
    ok: true,
    groups,
    pagination: {
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
      from: totalRows ? start + 1 : 0,
      to: Math.min(totalRows, start + pageSize),
    },
    filters: {
      q: s(req.query.q),
      includeInactive,
    },
  })
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave/profiles/:employeeId
───────────────────────────────────────────────────────────── */
exports.getProfileOne = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const plain = await buildProfileResponseByEmployeeId(employeeId)
  return res.json(plain)
}

/* ─────────────────────────────────────────────────────────────
   GET /leave/profile/me
───────────────────────────────────────────────────────────── */
exports.getMyProfile = async (req, res) => {
  const employeeId = await resolveEmployeeIdFromReq(req)
  if (!employeeId) {
    throw createError(404, 'Employee profile not found for current user')
  }

  const plain = await buildProfileResponseByEmployeeId(employeeId)
  return res.json(plain)
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles
───────────────────────────────────────────────────────────── */
exports.createProfileSingle = async (req, res) => {
  const body = req.body || {}

  const employeeId = s(body.employeeId)
  if (!employeeId) throw createError(400, 'employeeId is required')

  const existing = await LeaveProfile.findOne({ employeeId })
  if (existing) throw createError(409, 'Leave profile already exists')

  const employeeLoginId = s(body.employeeLoginId || body.loginId || body.employeeId)
  if (!employeeLoginId) throw createError(400, 'employeeLoginId/loginId is required')

  const approvalMode = normalizeApprovalMode(body.approvalMode)

  const managerLoginId = modeInvolvesManager(approvalMode) ? s(body.managerLoginId) : ''
  if (managerLoginId) await ensureManagerRole(managerLoginId)

  const gmLoginId = modeInvolvesGm(approvalMode) ? FIXED.GM_LOGIN_ID : ''
  const cooLoginId = modeInvolvesCoo(approvalMode) ? FIXED.COO_LOGIN_ID : ''

  validateModeApprovers(approvalMode, { managerLoginId, gmLoginId, cooLoginId })

  await ensureUserAccount({
    loginId: employeeLoginId,
    employeeId,
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
    managerLoginId,
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
  await syncUserRolesForProfile(saved)
  emitProfile(req, saved, 'leave:profile:created')

  let plain = await attachEmployeeDirectory(saved.toObject())
  plain = decorateProfileForResponse(plain)
  return res.status(201).json(plain)
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/leave/profiles/manager
───────────────────────────────────────────────────────────── */
exports.createManagerWithEmployees = async (req, res) => {
  const body = req.body || {}
  const approvalMode = normalizeApprovalMode(body.approvalMode)

  const managerLoginId = modeInvolvesManager(approvalMode) ? s(body.managerLoginId) : ''
  if (managerLoginId) await ensureManagerRole(managerLoginId)

  const gmLoginId = modeInvolvesGm(approvalMode) ? FIXED.GM_LOGIN_ID : ''
  const cooLoginId = modeInvolvesCoo(approvalMode) ? FIXED.COO_LOGIN_ID : ''

  validateModeApprovers(approvalMode, { managerLoginId, gmLoginId, cooLoginId })

  const employees = Array.isArray(body.employees) ? body.employees : []
  if (!employees.length) throw createError(400, 'employees[] is required')

  const created = []

  for (const e of employees) {
    const empId = s(e.employeeId)
    if (!empId) continue

    const exists = await LeaveProfile.findOne({ employeeId: empId })
    if (exists) continue

    const empLoginId = s(e.employeeLoginId || e.loginId || empId)
    if (!empLoginId) throw createError(400, `employeeLoginId missing for employeeId=${empId}`)

    await ensureUserAccount({
      loginId: empLoginId,
      employeeId: empId,
      password: e.password,
    })

    const joinDate = s(e.joinDate)
    if (!isValidYMD(joinDate)) throw createError(400, `joinDate must be YYYY-MM-DD for employeeId=${empId}`)

    const contractDate = s(e.contractDate || joinDate)
    if (!isValidYMD(contractDate)) throw createError(400, `contractDate must be YYYY-MM-DD for employeeId=${empId}`)

    const endDate = contractEndFromStart(contractDate)
    const initialCarry = normalizeCarryObj(e.carry)

    const doc = await LeaveProfile.create({
      employeeId: empId,
      employeeLoginId: empLoginId,
      managerLoginId,
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
    await syncUserRolesForProfile(saved)
    emitProfile(req, saved, 'leave:profile:created')

    let plain = await attachEmployeeDirectory(saved.toObject())
    plain = decorateProfileForResponse(plain)
    created.push(plain)
  }

  return res.json({ ok: true, createdCount: created.length, created })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId
───────────────────────────────────────────────────────────── */
exports.updateProfile = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const body = req.body || {}

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const nextApprovalMode = normalizeApprovalMode(body.approvalMode ?? doc.approvalMode)

  const managerAllowed = modeInvolvesManager(nextApprovalMode)
  const nextManager = managerAllowed ? s(body.managerLoginId ?? doc.managerLoginId) : ''
  if (nextManager) await ensureManagerRole(nextManager)

  const nextGm = modeInvolvesGm(nextApprovalMode) ? FIXED.GM_LOGIN_ID : ''
  const nextCoo = modeInvolvesCoo(nextApprovalMode) ? FIXED.COO_LOGIN_ID : ''

  validateModeApprovers(nextApprovalMode, {
    managerLoginId: nextManager,
    gmLoginId: nextGm,
    cooLoginId: nextCoo,
  })

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
  if (body.position !== undefined) doc.position = s(body.position)
  if (body.contactNumber !== undefined) doc.contactNumber = s(body.contactNumber)
  if (body.telegramChatId !== undefined) doc.telegramChatId = s(body.telegramChatId)
  if (body.employeeLoginId !== undefined) doc.employeeLoginId = s(body.employeeLoginId)

  setPointersToLatest(doc)

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  let plain = await attachEmployeeDirectory(saved.toObject())
  plain = decorateProfileForResponse(plain)
  return res.json(plain)
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/leave/profiles/:employeeId
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
  await syncUserRolesForProfile(saved)
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
  const { clearUnusedAL = true, note = '' } = req.body || {}

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  if (!Array.isArray(doc.contracts) || !doc.contracts.length) {
    throw createError(400, 'Cannot renew because this profile has no contract history')
  }

  const latest = latestContract(doc.contracts)
  if (!latest) throw createError(400, 'Latest contract not found')

  const latestEndDate = isValidYMD(latest.endDate)
    ? s(latest.endDate)
    : s(doc.contractEndDate)

  if (!isValidYMD(latestEndDate)) {
    throw createError(400, 'Latest contract end date is invalid')
  }

  const forcedNewContractDate = nextDayYMD(latestEndDate)
  if (!isValidYMD(forcedNewContractDate)) {
    throw createError(400, 'Cannot calculate next contract start date')
  }

  const asOf = latestEndDate
  const asOfDate = ymdToUTCDate(asOf) || new Date()

  const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()

  const plainForClose = doc.toObject ? doc.toObject() : { ...doc }
  plainForClose.balances = []
  plainForClose.balancesAsOf = ''

  const closeSnap = computeBalances(plainForClose, approved, asOfDate, {
    asOfYMD: asOf,
    contractNo: latest?.contractNo || undefined,
  })

  const closeRawBalances = Array.isArray(closeSnap?.balances) ? closeSnap.balances : []

  const currentCarry = normalizeCarryObj(latest?.carry || {})
  const closeDisplayBalances = applyCarryToBalancesForDisplay(closeRawBalances, currentCarry)

  if (!latest.closedAt) {
    latest.closedAt = new Date()
    latest.closedBy = s(req.user?.loginId || '')
    latest.note = s(note || latest.note || '')

    latest.closeSnapshot = {
      asOf: asOf || s(closeSnap?.meta?.asOfYMD || ''),
      contractDate: s(latest.startDate || doc.contractDate || ''),
      contractEndDate: s(latest.endDate || doc.contractEndDate || ''),
      carry: currentCarry,
      balances: closeDisplayBalances,
    }
  }

  let closingAlRemaining = 0
  try {
    const al = closeDisplayBalances.find((b) => up(b.leaveTypeCode) === 'AL')
    closingAlRemaining = num(al?.remaining)
  } catch {}

  const nextALCarry = clearUnusedAL
    ? (closingAlRemaining < 0 ? closingAlRemaining : 0)
    : closingAlRemaining

  const nextContractNo = doc.contracts.length
    ? Math.max(...doc.contracts.map((c) => num(c.contractNo))) + 1
    : 1

  const endDate = contractEndFromStart(forcedNewContractDate)
  const newCarry = {
    AL: nextALCarry,
    SP: 0,
    MC: 0,
    MA: 0,
    UL: 0,
  }

  doc.contracts.push({
    contractNo: nextContractNo,
    startDate: forcedNewContractDate,
    endDate,
    carry: newCarry,
    openedAt: new Date(),
    openedBy: s(req.user?.loginId || ''),
    note: s(note || ''),
    openSnapshot: {
      asOf: forcedNewContractDate,
      contractDate: forcedNewContractDate,
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
    forcedNewContractDate,
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

  const latest = latestContract(saved.contracts || [])
  const activeCarry = normalizeCarryObj(latest?.carry || {})

  return res.json({
    ok: true,
    employeeId,
    balances: applyCarryToBalancesForDisplay(saved.balances || [], activeCarry),
    balancesAsOf: saved.balancesAsOf,
  })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId/password
───────────────────────────────────────────────────────────── */
exports.resetUserPassword = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const { password } = req.body || {}

  if (!employeeId) throw createError(400, 'employeeId is required')
  if (!password) throw createError(400, 'password is required')

  const prof = await LeaveProfile.findOne({ employeeId })
  if (!prof) throw createError(404, 'Profile not found')

  const loginId = s(prof.employeeLoginId || employeeId)
  if (!loginId) throw createError(400, 'Profile missing employeeLoginId')

  const err = validateStrongPassword(password)
  if (err) throw createError(400, err)

  // Find user by loginId first, then by employeeId
  let user = await User.findOne({ loginId })
  if (!user) {
    user = await User.findOne({ employeeId })
  }

  // If user does not exist, create it properly with employeeId
  if (!user) {
    user = await ensureUserAccount({
      loginId,
      employeeId,
      password,
    })
  }

  // Check if another user already owns this employeeId
  const owner = await User.findOne({
    employeeId,
    _id: { $ne: user._id },
  }).lean()

  if (owner) {
    throw createError(
      409,
      `employeeId ${employeeId} is already used by another user account: ${s(owner.loginId)}`
    )
  }

  // ✅ Fix old bad data: never keep employeeId empty
  user.employeeId = employeeId

  if (!user.loginId) {
    user.loginId = loginId
  }

  if (typeof user.setPassword === 'function') {
    await user.setPassword(password)
  } else {
    user.passwordHash = await bcrypt.hash(s(password), 10)
    user.passwordChangedAt = new Date()
    user.passwordVersion = Number(user.passwordVersion || 0) + 1
  }

  user.isActive = user.isActive === false ? false : true

  await user.save()

  // Also fix profile loginId if old profile missed it
  if (!s(prof.employeeLoginId)) {
    prof.employeeLoginId = loginId
    await prof.save()
  }

  return res.json({
    ok: true,
    message: 'Password reset successfully. Existing sessions were invalidated.',
    employeeId,
    loginId,
    passwordVersion: Number(user.passwordVersion || 0),
  })
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/profiles/:employeeId/contracts/:contractNo/date
   ✅ edit ONLY latest/current contract start date
   ✅ auto recalculates end date = start + 1 year - 1 day
───────────────────────────────────────────────────────────── */
exports.updateContractDate = async (req, res) => {
  const employeeId = s(req.params.employeeId)
  const contractNo = Number(req.params.contractNo)
  const startDate = s(req.body?.startDate)

  if (!Number.isFinite(contractNo) || contractNo <= 0) {
    throw createError(400, 'Invalid contractNo')
  }

  if (!isValidYMD(startDate)) {
    throw createError(400, 'startDate must be YYYY-MM-DD')
  }

  const doc = await LeaveProfile.findOne({ employeeId })
  if (!doc) throw createError(404, 'Profile not found')

  const idx = (doc.contracts || []).findIndex((c) => Number(c.contractNo) === contractNo)
  if (idx < 0) throw createError(404, 'Contract not found')

  const target = doc.contracts[idx]
  const latest = latestContract(doc.contracts || [])

  if (!latest || Number(latest.contractNo) !== contractNo) {
    throw createError(400, 'Only the latest/current contract date can be edited')
  }

  const newEndDate = contractEndFromStart(startDate)

  target.startDate = startDate
  target.endDate = newEndDate

  if (target.openSnapshot) {
    target.openSnapshot.asOf = startDate
    target.openSnapshot.contractDate = startDate
    target.openSnapshot.contractEndDate = newEndDate
  }

  doc.contractDate = startDate
  doc.contractEndDate = newEndDate

  const saved = await recomputeAndSaveBalances(doc)
  emitProfile(req, saved, 'leave:profile:updated')

  return res.json({
    ok: true,
    employeeId,
    contractNo,
    contractDate: saved.contractDate,
    contractEndDate: saved.contractEndDate,
    contract: saved.contracts.find((c) => Number(c.contractNo) === contractNo),
  })
}