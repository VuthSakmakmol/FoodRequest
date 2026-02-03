/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js

const bcrypt = require('bcryptjs')
const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/leave.realtime')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const DEFAULT_PWD_POLICY = process.env.LEAVE_DEFAULT_PASSWORD || '123456'

/**
 * ✅ Seeded approvers (you already seed these users)
 * - GM always exists (1 user)
 * - COO exists (1 user) used only for GM_AND_COO mode
 */
const SEED_GM_LOGINID = String(process.env.LEAVE_GM_LOGINID || 'leave_gm').trim()
const SEED_COO_LOGINID = String(process.env.LEAVE_COO_LOGINID || 'leave_coo').trim()

/**
 * ✅ UI semantic modes (your UI uses these 2 only)
 * - MANAGER_AND_GM
 * - GM_AND_COO
 */
const SEMANTIC_MODES = Object.freeze(['MANAGER_AND_GM', 'GM_AND_COO'])

/* ───────────────── helpers ───────────────── */

// Password
function isDigitsOnly(v) {
  return /^\d+$/.test(String(v || '').trim())
}

function formulaPassword(loginId) {
  // Use BigInt to avoid JS number overflow for long numeric IDs
  const n = BigInt(String(loginId).trim())
  return `${n * 2n}A`
}


const s = (v) => String(v ?? '').trim()

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitProfile(req, docOrPlain, event = 'leave:profile:updated') {
  try {
    const io = getIo(req)
    if (!io) return
    broadcastLeaveProfile(io, docOrPlain, event)
  } catch (e) {
    console.warn('⚠️ emitProfile failed:', e?.message)
  }
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}
function assertYMD(v, label = 'date') {
  const val = s(v)
  if (!isValidYMD(val)) throw createError(400, `Invalid ${label}. Expected YYYY-MM-DD, got "${v}"`)
  return val
}

function nowYMD(tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}
function addDaysYMD(ymd, deltaDays) {
  const d = ymdToUTCDate(assertYMD(ymd, 'date'))
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addYearsYMD(ymd, deltaYears) {
  const d = ymdToUTCDate(assertYMD(ymd, 'date'))
  d.setUTCFullYear(d.getUTCFullYear() + Number(deltaYears || 0))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function computeContractEndYMD(startYMD) {
  // end = start + 1 year - 1 day
  return addDaysYMD(addYearsYMD(assertYMD(startYMD, 'contractStart'), 1), -1)
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '')
}

/* ───────── approvalMode: semantic <-> stored enum (auto adapt to schema enum) ───────── */

function getModelEnumApprovalModes() {
  try {
    const path = LeaveProfile?.schema?.path?.('approvalMode')
    const enums = path?.enumValues
    return Array.isArray(enums) ? enums.map((x) => String(x)) : []
  } catch {
    return []
  }
}

/**
 * Normalize any incoming value into 2 semantic modes.
 * Keep backward-compat with older UI values.
 */
function normalizeApprovalModeSemantic(v) {
  const m = s(v).toUpperCase()

  // Old values you may have used:
  // ADMIN_AND_GM -> MANAGER_AND_GM
  // GM_ONLY -> MANAGER_AND_GM
  // GM_OR_COO -> GM_AND_COO
  if (m === 'ADMIN_AND_GM') return 'MANAGER_AND_GM'
  if (m === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (m === 'GM_OR_COO') return 'GM_AND_COO'
  if (m === 'GM_AND_COO') return 'GM_AND_COO'
  if (m === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'

  // safe fallback
  return 'MANAGER_AND_GM'
}

/**
 * Convert semantic mode to whatever the LeaveProfile schema enum expects.
 * This fixes your runtime error:
 *   "approvalMode: 'MANAGER_AND_GM' is not a valid enum value"
 * when schema still uses older enum like "ADMIN_AND_GM".
 */
function toStoredApprovalMode(semanticMode) {
  const sem = normalizeApprovalModeSemantic(semanticMode)
  const enums = getModelEnumApprovalModes()

  // If schema has no enum restriction, just store semantic
  if (!enums.length) return sem

  // Preferred: store semantic if allowed
  if (enums.includes(sem)) return sem

  // Map semantic to known older enums
  const map = {
    MANAGER_AND_GM: ['ADMIN_AND_GM', 'MANAGER_GM', 'MGR_AND_GM', 'MANAGER_GM_ONLY'],
    GM_AND_COO: ['GM_OR_COO', 'COO_AND_GM', 'GM_COO', 'GM_THEN_COO'],
  }

  const candidates = map[sem] || []
  for (const c of candidates) {
    if (enums.includes(c)) return c
  }

  // If nothing matches, fallback to the first enum value (safe to pass validation)
  return enums[0]
}

/**
 * Convert stored enum value back to semantic mode for UI.
 */
function toSemanticApprovalMode(storedMode) {
  const m = s(storedMode).toUpperCase()
  if (m === 'GM_AND_COO' || m === 'GM_OR_COO' || m === 'GM_COO' || m === 'COO_AND_GM') return 'GM_AND_COO'
  // treat everything else as manager+gm
  return 'MANAGER_AND_GM'
}

/* ───────── pickers ───────── */

function pickEmployeeId(obj) {
  return s(obj?.employeeId || obj?.employee?.employeeId || obj?.selectedEmployee?.employeeId || obj?.id || '')
}

function pickManagerEmployeeId(obj) {
  // UI may send managerEmployeeId or managerLoginId; both are employeeId-like
  return s(obj?.managerEmployeeId || obj?.managerLoginId || obj?.manager?.employeeId || '')
}

/* ───────── directory + user upsert ───────── */

async function getDirectory(employeeId) {
  const eid = s(employeeId)
  if (!eid) return null
  return EmployeeDirectory.findOne({ employeeId: eid })
    .select('employeeId name department telegramChatId isActive')
    .lean()
}

async function ensureUser({ loginId, name, role, roles, isActive = true, telegramChatId = '' }) {
  const id = s(loginId)
  if (!id) return null

  const cleanChatId = s(telegramChatId)

  const addRoles = [
    ...(Array.isArray(roles) ? roles : roles ? [roles] : []),
    ...(role ? [role] : []),
  ]
    .map((r) => s(r).toUpperCase())
    .filter(Boolean)

  const existing = await User.findOne({ loginId: id })
  if (existing) {
    const $set = {}
    const $addToSet = {}

    if (name && existing.name !== name) $set.name = name
    if (typeof isActive === 'boolean' && existing.isActive !== isActive) $set.isActive = isActive
    if (cleanChatId && s(existing.telegramChatId) !== cleanChatId) $set.telegramChatId = cleanChatId

    if (addRoles.length) $addToSet.roles = { $each: addRoles }

    // ensure base role exists
    const curRole = s(existing.role)
    if (!curRole && addRoles.length) $set.role = addRoles[0]

    const update = {}
    if (Object.keys($set).length) update.$set = $set
    if (Object.keys($addToSet).length) update.$addToSet = $addToSet

    if (Object.keys(update).length) {
      return User.findOneAndUpdate({ _id: existing._id }, update, { new: true })
    }
    return existing
  }

  let plainPwd = ''

  // ✅ Employee numeric loginId uses your formula: (loginId * 2) + 'A'
  if (isDigitsOnly(id)) {
    plainPwd = formulaPassword(id)
  } else {
    // ✅ Seeded / non-numeric users fallback to env policy or default
    plainPwd = DEFAULT_PWD_POLICY === 'EMPLOYEE_ID' ? id : DEFAULT_PWD_POLICY
  }

  const passwordHash = await bcrypt.hash(String(plainPwd), 10)


  const mainRole = (addRoles[0] || 'LEAVE_USER').toUpperCase()

  return User.create({
    loginId: id,
    name: name || id,
    role: mainRole,
    roles: addRoles.length ? addRoles : [mainRole],
    passwordHash,
    isActive: !!isActive,
    ...(cleanChatId ? { telegramChatId: cleanChatId } : {}),
  })
}

/* ───────── balances sync ───────── */

function sameJSON(a, b) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

async function syncBalancesForProfile(doc, asOfYMD) {
  if (!doc) return
  const asOf = isValidYMD(asOfYMD) ? asOfYMD : nowYMD()

  const employeeId = s(doc.employeeId)
  if (!employeeId) return

  const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()

  const base = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const snap = computeBalances(base, approved, new Date(asOf + 'T00:00:00Z'))

  const nextBalances = Array.isArray(snap?.balances) ? snap.balances : []
  const nextEnd = s(snap?.meta?.contractYear?.endDate || doc.contractEndDate || '')

  if (!sameJSON(doc.balances, nextBalances)) doc.balances = nextBalances
  if (s(doc.balancesAsOf) !== asOf) doc.balancesAsOf = asOf
  if (nextEnd && s(doc.contractEndDate) !== nextEnd) doc.contractEndDate = nextEnd
}

function ensureContractsInitialized(doc, openedBy = '') {
  if (!Array.isArray(doc.contracts) || doc.contracts.length === 0) {
    const start =
      doc.contractDate && isValidYMD(doc.contractDate)
        ? doc.contractDate
        : doc.joinDate && isValidYMD(doc.joinDate)
          ? doc.joinDate
          : ''

    const end = start ? computeContractEndYMD(start) : ''

    doc.contracts = [
      {
        contractNo: 1,
        startDate: start,
        endDate: end,
        openedAt: new Date(),
        closedAt: null,
        openedBy: openedBy || '',
        closedBy: '',
        note: 'Initial contract',
        closeSnapshot: null,
      },
    ]
  }
}

/* ───────── seeded approvers + validation ───────── */

function resolveSeededApprovers(semanticMode) {
  if (!SEED_GM_LOGINID) throw createError(500, 'Seed GM missing. Set LEAVE_GM_LOGINID.')
  if (semanticMode === 'GM_AND_COO' && !SEED_COO_LOGINID) {
    throw createError(500, 'Seed COO missing. Set LEAVE_COO_LOGINID for GM_AND_COO mode.')
  }
  return {
    gmLoginId: SEED_GM_LOGINID,
    cooLoginId: semanticMode === 'GM_AND_COO' ? SEED_COO_LOGINID : '',
  }
}

function validateModeAndChain({ approvalMode, managerEmployeeId }) {
  const semantic = normalizeApprovalModeSemantic(approvalMode)

  if (semantic === 'MANAGER_AND_GM') {
    if (!s(managerEmployeeId)) {
      throw createError(400, 'Manager is required for Manager + GM mode.')
    }
  }

  // GM_AND_COO => manager optional
  return semantic
}

/* ───────────────── controllers (exported) ───────────────── */

/**
 * GET /api/admin/leave/approvers
 * (Optional endpoint — your UI can show "auto from seed" without searching)
 */
exports.getApprovers = async (req, res) => {
  try {
    const wanted = ['LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN']
    const docs = await User.find({
      isActive: true,
      $or: [{ role: { $in: wanted } }, { roles: { $in: wanted } }],
    })
      .select('loginId name role roles telegramChatId')
      .lean()

    res.json(
      (docs || []).map((d) => ({
        loginId: s(d.loginId),
        name: d.name || '',
        role: d.role || '',
        roles: Array.isArray(d.roles) ? d.roles : [],
        telegramChatId: s(d.telegramChatId),
      }))
    )
  } catch (e) {
    console.error('getApprovers error', e)
    res.status(500).json({ message: 'Failed to load approvers.' })
  }
}

/**
 * GET /api/admin/leave/profiles/grouped?includeInactive=0|1
 */
exports.getProfilesGrouped = async (req, res) => {
  try {
    const includeInactive = s(req.query?.includeInactive) === '1'
    const query = includeInactive ? {} : { isActive: { $ne: false } }

    // auto-fix balances for active profiles (safe)
    const profiles = await LeaveProfile.find(query)
    const asOf = nowYMD()

    for (const doc of profiles || []) {
      if (doc?.isActive === false) continue
      if (!doc.joinDate || !isValidYMD(doc.joinDate)) continue

      if (!doc.contractDate || !isValidYMD(doc.contractDate)) doc.contractDate = doc.joinDate
      ensureContractsInitialized(doc, actorLoginId(req))

      await syncBalancesForProfile(doc, asOf)

      if (doc.isModified()) {
        await doc.save()
        emitProfile(req, doc, 'leave:profile:updated')
      }
    }

    const fresh = await LeaveProfile.find(query).lean()

    // group by managerEmployeeId/managerLoginId for UI
    const byMgr = new Map()
    for (const p of fresh || []) {
      const mgrId = s(p.managerEmployeeId || p.managerLoginId) || '—'
      if (!byMgr.has(mgrId)) byMgr.set(mgrId, [])
      byMgr.get(mgrId).push(p)
    }

    // resolve manager directory info
    const managerIds = Array.from(byMgr.keys()).filter((x) => x && x !== '—')
    const mgrDirs = await EmployeeDirectory.find({ employeeId: { $in: managerIds } })
      .select('employeeId name department')
      .lean()
    const mgrMap = new Map((mgrDirs || []).map((d) => [s(d.employeeId), d]))

    const out = []
    for (const [managerId, emps] of byMgr.entries()) {
      const md = mgrMap.get(s(managerId)) || null

      const employees = (emps || [])
        .slice()
        .sort((a, b) => s(a.employeeId).localeCompare(s(b.employeeId)))
        .map((x) => ({
          employeeId: s(x.employeeId),
          name: x.name || '',
          department: x.department || '',
          joinDate: x.joinDate || null,
          contractDate: x.contractDate || null,
          contractEndDate: x.contractEndDate || null,

          managerEmployeeId: s(x.managerEmployeeId || x.managerLoginId),
          managerLoginId: s(x.managerLoginId || x.managerEmployeeId),
          gmLoginId: s(x.gmLoginId),
          cooLoginId: s(x.cooLoginId),

          // ✅ always return semantic mode to UI
          approvalMode: toSemanticApprovalMode(x.approvalMode),

          isActive: x.isActive !== false,
          balances: Array.isArray(x.balances) ? x.balances : [],
          contracts: Array.isArray(x.contracts) ? x.contracts : [],
          balancesAsOf: x.balancesAsOf || null,
          alCarry: x.alCarry ?? 0,
        }))

      out.push({
        manager: {
          employeeId: managerId,
          name: md?.name || '',
          department: md?.department || '',
        },
        employees,
      })
    }

    out.sort((a, b) => s(a.manager.employeeId).localeCompare(s(b.manager.employeeId)))
    res.json(out)
  } catch (e) {
    console.error('getProfilesGrouped error', e)
    res.status(500).json({ message: 'Failed to load grouped profiles.' })
  }
}

/**
 * GET /api/admin/leave/profiles/:employeeId
 */
exports.getProfileOne = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    // normalize approvalMode for UI consistency
    prof.approvalMode = toSemanticApprovalMode(prof.approvalMode)

    return res.json({ profile: prof })
  } catch (e) {
    console.error('getProfileOne error', e)
    res.status(500).json({ message: 'Failed to load profile.' })
  }
}

/**
 * POST /api/admin/leave/profiles
 * Create/Upsert SINGLE profile
 *
 * Body:
 * {
 *   approvalMode: "MANAGER_AND_GM" | "GM_AND_COO" (semantic)
 *   managerEmployeeId? (required when MANAGER_AND_GM)
 *   employeeId, joinDate, contractDate?, alCarry?, isActive?
 * }
 *
 * ✅ GM/COO are AUTO from seed (no need to select from UI)
 */
exports.createProfileSingle = async (req, res) => {
  try {
    const body = req.body || {}

    const employeeId = pickEmployeeId(body)
    const managerEmployeeId = pickManagerEmployeeId(body)

    const joinDate = body.joinDate ? assertYMD(body.joinDate, 'joinDate') : ''
    let contractDate = body.contractDate ? assertYMD(body.contractDate, 'contractDate') : ''
    if (joinDate && !contractDate) contractDate = joinDate

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })
    if (!joinDate) return res.status(400).json({ message: 'joinDate is required.' })

    // validate mode + manager requirement (semantic)
    const semanticMode = validateModeAndChain({
      approvalMode: body.approvalMode,
      managerEmployeeId,
    })

    // map semantic -> schema enum (fix enum error)
    const storedMode = toStoredApprovalMode(semanticMode)

    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)
    const isActive = body.isActive !== false

    const empDir = await getDirectory(employeeId)
    const mgrDir = managerEmployeeId ? await getDirectory(managerEmployeeId) : null

    // ensure users exist
    await ensureUser({
      loginId: employeeId,
      name: empDir?.name || body.name || employeeId,
      role: 'LEAVE_USER',
      isActive,
      telegramChatId: empDir?.telegramChatId || '',
    })

    if (managerEmployeeId) {
      await ensureUser({
        loginId: managerEmployeeId,
        name: mgrDir?.name || managerEmployeeId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    // ensure seeded approvers exist as users (harmless if already there)
    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })

    let prof = await LeaveProfile.findOne({ employeeId })
    const existed = !!prof
    if (!prof) prof = new LeaveProfile({ employeeId, employeeLoginId: employeeId })

    // store chain fields (NO ADMIN stage)
    prof.approvalMode = storedMode
    prof.managerEmployeeId = managerEmployeeId || ''
    prof.managerLoginId = managerEmployeeId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

    // legacy field safety (if schema has it)
    if (typeof prof.adminLoginId !== 'undefined') prof.adminLoginId = ''

    prof.joinDate = joinDate
    prof.contractDate = contractDate
    prof.isActive = isActive
    if (body.alCarry !== undefined) prof.alCarry = Number(body.alCarry || 0)

    prof.name = empDir?.name || prof.name || ''
    prof.department = empDir?.department || prof.department || ''

    ensureContractsInitialized(prof, actorLoginId(req))
    await syncBalancesForProfile(prof, nowYMD())

    await prof.save()

    emitProfile(req, prof, existed ? 'leave:profile:updated' : 'leave:profile:created')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: semanticMode } })
  } catch (e) {
    console.error('createProfileSingle error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to create profile.' })
  }
}

/**
 * PATCH/PUT /api/admin/leave/profiles/:employeeId
 */
exports.updateProfile = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    const body = req.body || {}

    if (body.joinDate !== undefined) prof.joinDate = assertYMD(body.joinDate, 'joinDate')
    if (body.contractDate !== undefined) prof.contractDate = assertYMD(body.contractDate, 'contractDate')
    if (body.isActive !== undefined) prof.isActive = body.isActive !== false
    if (body.alCarry !== undefined) prof.alCarry = Number(body.alCarry || 0)

    const nextManagerId =
      body.managerEmployeeId !== undefined || body.managerLoginId !== undefined
        ? pickManagerEmployeeId(body)
        : s(prof.managerEmployeeId || prof.managerLoginId)

    const currentSemantic = toSemanticApprovalMode(prof.approvalMode)
    const nextSemantic =
      body.approvalMode !== undefined ? normalizeApprovalModeSemantic(body.approvalMode) : currentSemantic

    validateModeAndChain({ approvalMode: nextSemantic, managerEmployeeId: nextManagerId })

    const storedMode = toStoredApprovalMode(nextSemantic)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(nextSemantic)

    prof.approvalMode = storedMode
    prof.managerEmployeeId = nextManagerId || ''
    prof.managerLoginId = nextManagerId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = nextSemantic === 'GM_AND_COO' ? cooLoginId : ''

    if (typeof prof.adminLoginId !== 'undefined') prof.adminLoginId = ''

    ensureContractsInitialized(prof, actorLoginId(req))
    await syncBalancesForProfile(prof, nowYMD())

    await prof.save()
    emitProfile(req, prof, 'leave:profile:updated')

    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: nextSemantic } })
  } catch (e) {
    console.error('updateProfile error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to update profile.' })
  }
}

/**
 * DELETE /api/admin/leave/profiles/:employeeId
 * soft deactivate
 */
exports.deactivateProfile = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    prof.isActive = false
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, employeeId, isActive: false })
  } catch (e) {
    console.error('deactivateProfile error', e)
    res.status(500).json({ message: 'Failed to deactivate profile.' })
  }
}

/**
 * POST /api/admin/leave/managers
 * Create/Upsert MULTIPLE profiles under one manager.
 *
 * Body:
 * {
 *   approvalMode: "MANAGER_AND_GM" | "GM_AND_COO" (semantic)
 *   managerEmployeeId? (required when MANAGER_AND_GM)
 *   employees: [{ employeeId, joinDate, contractDate?, alCarry?, isActive? }]
 * }
 *
 * ✅ GM/COO are AUTO from seed (no need to select from UI)
 */
exports.createManagerWithEmployees = async (req, res) => {
  try {
    const body = req.body || {}
    const rows = Array.isArray(body.employees) ? body.employees : []
    if (!rows.length) return res.status(400).json({ message: 'employees[] is required.' })

    const managerEmployeeId = pickManagerEmployeeId(body)

    const semanticMode = validateModeAndChain({
      approvalMode: body.approvalMode,
      managerEmployeeId,
    })

    const storedMode = toStoredApprovalMode(semanticMode)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)

    // ensure manager user if provided
    if (managerEmployeeId) {
      const mgrDir = await getDirectory(managerEmployeeId)
      await ensureUser({
        loginId: managerEmployeeId,
        name: mgrDir?.name || managerEmployeeId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })

    let createdCount = 0
    let updatedCount = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {}
      const empId = pickEmployeeId(r)
      if (!empId) throw createError(400, `Employee #${i + 1}: employeeId is required.`)

      const joinDate = assertYMD(r.joinDate, `joinDate (Employee #${i + 1})`)
      const contractDate = r.contractDate ? assertYMD(r.contractDate, `contractDate (Employee #${i + 1})`) : joinDate
      const isActive = r.isActive !== false

      const empDir = await getDirectory(empId)

      await ensureUser({
        loginId: empId,
        name: empDir?.name || empId,
        role: 'LEAVE_USER',
        isActive,
        telegramChatId: empDir?.telegramChatId || '',
      })

      let prof = await LeaveProfile.findOne({ employeeId: empId })
      const existed = !!prof
      if (!prof) prof = new LeaveProfile({ employeeId: empId, employeeLoginId: empId })

      prof.approvalMode = storedMode
      prof.managerEmployeeId = managerEmployeeId || ''
      prof.managerLoginId = managerEmployeeId || ''
      prof.gmLoginId = gmLoginId
      prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

      if (typeof prof.adminLoginId !== 'undefined') prof.adminLoginId = ''

      prof.joinDate = joinDate
      prof.contractDate = contractDate
      prof.alCarry = Number(r.alCarry || 0)
      prof.isActive = isActive

      prof.name = empDir?.name || prof.name || ''
      prof.department = empDir?.department || prof.department || ''

      ensureContractsInitialized(prof, actorLoginId(req))
      await syncBalancesForProfile(prof, nowYMD())

      await prof.save()
      emitProfile(req, prof, existed ? 'leave:profile:updated' : 'leave:profile:created')

      if (existed) updatedCount++
      else createdCount++
    }

    res.json({ ok: true, createdCount, updatedCount, approvalMode: semanticMode })
  } catch (e) {
    console.error('createManagerWithEmployees error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to create manager + employees.' })
  }
}

/**
 * POST /api/admin/leave/profiles/:employeeId/contracts/renew
 * Body: { newContractDate: 'YYYY-MM-DD', clearUnusedAL?: boolean, note?: string }
 */
exports.renewContract = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    const body = req.body || {}
    const newContractDate = assertYMD(body.newContractDate, 'newContractDate')
    const note = s(body.note || 'Renew contract')
    const clearUnusedAL = body.clearUnusedAL === true

    ensureContractsInitialized(prof, actorLoginId(req))

    // close previous contract
    const last = prof.contracts[prof.contracts.length - 1]
    if (last && !last.closedAt) {
      last.closedAt = new Date()
      last.closedBy = actorLoginId(req)
      last.note = last.note || 'Closed on renewal'
      last.closeSnapshot = {
        balances: Array.isArray(prof.balances) ? prof.balances : [],
        balancesAsOf: prof.balancesAsOf || null,
      }
    }

    // open new contract
    const nextNo = (last?.contractNo || prof.contracts.length || 0) + 1
    prof.contractDate = newContractDate
    const endDate = computeContractEndYMD(newContractDate)

    prof.contracts.push({
      contractNo: nextNo,
      startDate: newContractDate,
      endDate,
      openedAt: new Date(),
      closedAt: null,
      openedBy: actorLoginId(req),
      closedBy: '',
      note,
      closeSnapshot: null,
    })

    // optional: clear unused AL carry (positive only)
    if (clearUnusedAL) {
      if (typeof prof.alCarry !== 'undefined' && Number(prof.alCarry) > 0) prof.alCarry = 0
    }

    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: toSemanticApprovalMode(prof.approvalMode) } })
  } catch (e) {
    console.error('renewContract error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to renew contract.' })
  }
}
