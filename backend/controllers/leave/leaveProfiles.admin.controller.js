/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js
//
// ✅ IMPORTANT (new behavior):
// - Carry is PER-CONTRACT: stored in contracts[].carry (NOT profile.carry)
// - profile.carry + alCarry remain ONLY for legacy compatibility / migration
// - Balances calculation uses ACTIVE/LATEST contract carry by default
// - Renew creates a NEW contract with its own carry
//
// Requires:
// - LeaveProfile model has:
//    contracts[].{ contractNo,startDate,endDate,openedAt,closedAt,openedBy,closedBy,note,closeSnapshot, carry }
//    closeSnapshot.{ asOf, balances, contractDate, contractEndDate, carry }
// - utils: backend/utils/leave/leave.contracts.js exports:
//    ensureContracts(doc)
//    pickActiveContract(doc, opts?)
//    pickLatestContract(doc)
//    normalizeCarry(obj)
//    getActiveCarry(doc, opts?)
//    endFromStartYMD(startYMD)
//    isValidYMD(ymd)

const bcrypt = require('bcryptjs')
const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/leave.realtime')

const {
  ensureContracts,
  pickActiveContract,
  pickLatestContract,
  normalizeCarry,
  getActiveCarry,
  endFromStartYMD,
  isValidYMD,
} = require('../../utils/leave/leave.contracts')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'

// You said: admin must input password (>=13 strong).
// Keep fallback only if you don’t pass password explicitly.
const DEFAULT_PWD_POLICY = process.env.LEAVE_DEFAULT_PASSWORD || '123456'

// Seeded approvers
const SEED_GM_LOGINID = String(process.env.LEAVE_GM_LOGINID || 'leave_gm').trim()
const SEED_COO_LOGINID = String(process.env.LEAVE_COO_LOGINID || 'leave_coo').trim()

/* ───────────────── helpers ───────────────── */

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

function assertYMD(v, label = 'date') {
  const val = s(v)
  if (!isValidYMD(val)) throw createError(400, `Invalid ${label}. Expected YYYY-MM-DD, got "${v}"`)
  return val
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '')
}

/* ───────── approvalMode mapping ─────────
   stored enum in schema: GM_ONLY / GM_AND_COO
   semantic for UI:       MANAGER_AND_GM / GM_AND_COO
*/

function normalizeApprovalModeSemantic(v) {
  const m = s(v).toUpperCase()
  if (m === 'GM_AND_COO') return 'GM_AND_COO'
  // backward compat inputs
  if (m === 'GM_OR_COO') return 'GM_AND_COO'
  return 'MANAGER_AND_GM'
}

function toStoredApprovalMode(semanticMode) {
  const sem = normalizeApprovalModeSemantic(semanticMode)
  return sem === 'GM_AND_COO' ? 'GM_AND_COO' : 'GM_ONLY'
}

function toSemanticApprovalMode(storedMode) {
  const m = s(storedMode).toUpperCase()
  return m === 'GM_AND_COO' ? 'GM_AND_COO' : 'MANAGER_AND_GM'
}

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

function validateModeAndChain({ approvalMode, managerEmployeeIdOrLogin }) {
  const semantic = normalizeApprovalModeSemantic(approvalMode)
  if (semantic === 'MANAGER_AND_GM') {
    if (!s(managerEmployeeIdOrLogin)) throw createError(400, 'Manager is required for Manager + GM mode.')
  }
  return semantic
}

/* ───────── pickers ───────── */

function pickEmployeeId(obj) {
  return s(obj?.employeeId || obj?.employee?.employeeId || obj?.selectedEmployee?.employeeId || obj?.id || '')
}

function pickManagerId(obj) {
  // UI passes managerEmployeeId (employeeId). Legacy was managerLoginId.
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

function validateStrongPassword(pwd) {
  const p = String(pwd || '')
  if (p.length < 13) return { ok: false, message: 'Password must be at least 13 characters.' }
  const hasUpper = /[A-Z]/.test(p)
  const hasLower = /[a-z]/.test(p)
  const hasNum = /\d/.test(p)
  const hasSym = /[^A-Za-z0-9]/.test(p)
  const score = [hasUpper, hasLower, hasNum, hasSym].filter(Boolean).length
  if (score < 3) {
    return {
      ok: false,
      message: 'Password must include at least 3 of: uppercase, lowercase, number, symbol.',
    }
  }
  return { ok: true }
}

async function ensureUser({
  loginId,
  name,
  role,
  roles,
  isActive = true,
  telegramChatId = '',
  password, // ✅ optional (admin input)
}) {
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

    const curRole = s(existing.role)
    if (!curRole && addRoles.length) $set.role = addRoles[0]

    // ✅ optional: reset password if provided
    if (password !== undefined) {
      const check = validateStrongPassword(password)
      if (!check.ok) throw createError(400, check.message)
      $set.passwordHash = await bcrypt.hash(String(password), 10)
    }

    const update = {}
    if (Object.keys($set).length) update.$set = $set
    if (Object.keys($addToSet).length) update.$addToSet = $addToSet

    if (Object.keys(update).length) {
      return User.findOneAndUpdate({ _id: existing._id }, update, { new: true })
    }
    return existing
  }

  // ✅ NEW user: if admin supplies password, use it; else fallback policy
  let plainPwd = ''
  if (password !== undefined) {
    const check = validateStrongPassword(password)
    if (!check.ok) throw createError(400, check.message)
    plainPwd = String(password)
  } else {
    plainPwd = String(DEFAULT_PWD_POLICY || '123456')
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

/* ───────── balances helpers ───────── */

function sameJSON(a, b) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

/**
 * ✅ Apply carry to balances for DISPLAY + remaining math.
 * - entitlement = baseEnt + carry[type]
 * - remaining = entitlement - used
 * - SP remaining capped by AL remaining (SP consumes AL)
 * - UL entitlement stays 0
 */
function applyCarryToBalances(balances = [], carry = {}) {
  const c = normalizeCarry(carry)
  const out = (balances || []).map((b) => ({ ...(b || {}) }))

  const row = (code) => out.find((x) => s(x.leaveTypeCode).toUpperCase() === code)

  const applyOne = (code) => {
    const r = row(code)
    if (!r) return
    if (code === 'UL') {
      r.yearlyEntitlement = 0
      r.remaining = 0
      return
    }
    const used = Number(r.used || 0)
    const baseEnt = Number(r.yearlyEntitlement || 0)
    const ent = baseEnt + Number(c[code] || 0)
    r.yearlyEntitlement = ent
    r.remaining = ent - used
  }

  ;['AL', 'SP', 'MC', 'MA', 'UL'].forEach(applyOne)

  const al = row('AL')
  const sp = row('SP')
  if (al && sp) {
    sp.remaining = Math.min(Number(sp.remaining || 0), Number(al.remaining || 0))
  }

  return out
}

/**
 * ✅ Recompute balances for profile using ACTIVE/LATEST contract carry.
 * - ensureContracts() must align profile.contractDate to the active/latest contract start
 * - getActiveCarry() reads the active/latest contract carry
 */
async function syncBalancesForProfile(doc, asOfYMD, opts = {}) {
  if (!doc) return
  const asOf = isValidYMD(asOfYMD) ? asOfYMD : nowYMD()
  const employeeId = s(doc.employeeId)
  if (!employeeId) return

  ensureContracts(doc)

  const approved = await LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()

  const base = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const snap = computeBalances(base, approved, new Date(asOf + 'T00:00:00Z'))

  const raw = Array.isArray(snap?.balances) ? snap.balances : []
  const carry = getActiveCarry(doc, opts)
  const nextBalances = applyCarryToBalances(raw, carry)

  const active = pickActiveContract(doc, opts) || pickLatestContract(doc)
  const nextEnd =
    (active && isValidYMD(active.endDate) && active.endDate) ||
    (active && isValidYMD(active.startDate) ? endFromStartYMD(active.startDate) : '') ||
    s(snap?.meta?.contractYear?.endDate || doc.contractEndDate || '')

  if (!sameJSON(doc.balances, nextBalances)) doc.balances = nextBalances
  if (s(doc.balancesAsOf) !== asOf) doc.balancesAsOf = asOf
  if (nextEnd && s(doc.contractEndDate) !== nextEnd) doc.contractEndDate = nextEnd

  // ✅ legacy mirror only
  doc.alCarry = Number(normalizeCarry(carry).AL || 0)
}

/* ───────────────── controllers ───────────────── */

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

exports.getProfilesGrouped = async (req, res) => {
  try {
    const includeInactive = s(req.query?.includeInactive) === '1'
    const query = includeInactive ? {} : { isActive: { $ne: false } }

    const profiles = await LeaveProfile.find(query)
    const asOf = nowYMD()

    for (const doc of profiles || []) {
      if (doc?.isActive === false) continue
      if (!doc.joinDate || !isValidYMD(doc.joinDate)) continue

      ensureContracts(doc)
      await syncBalancesForProfile(doc, asOf)

      if (doc.isModified()) {
        await doc.save()
        emitProfile(req, doc, 'leave:profile:updated')
      }
    }

    const fresh = await LeaveProfile.find(query).lean()

    // group by managerLoginId field (it now contains manager employeeId in your system)
    const byMgr = new Map()
    for (const p of fresh || []) {
      const mgrId = s(p.managerLoginId) || '—'
      if (!byMgr.has(mgrId)) byMgr.set(mgrId, [])
      byMgr.get(mgrId).push(p)
    }

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
        .map((x) => {
          const semanticMode = toSemanticApprovalMode(x.approvalMode)
          const latest = Array.isArray(x.contracts) ? x.contracts[x.contracts.length - 1] : null
          const carry = normalizeCarry(latest?.carry || {})

          return {
            employeeId: s(x.employeeId),
            name: x.name || '',
            department: x.department || '',
            joinDate: x.joinDate || null,
            contractDate: x.contractDate || null,
            contractEndDate: x.contractEndDate || null,

            managerLoginId: s(x.managerLoginId),
            gmLoginId: s(x.gmLoginId),
            cooLoginId: s(x.cooLoginId),

            approvalMode: semanticMode,

            isActive: x.isActive !== false,
            balances: Array.isArray(x.balances) ? x.balances : [],
            balancesAsOf: x.balancesAsOf || null,
            contracts: Array.isArray(x.contracts) ? x.contracts : [],

            // ✅ per-contract carry (current/latest contract)
            carry,

            // legacy mirror only
            alCarry: Number(x.alCarry || 0),
          }
        })

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

exports.getProfileOne = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    prof.approvalMode = toSemanticApprovalMode(prof.approvalMode)

    const latest = Array.isArray(prof.contracts) ? prof.contracts[prof.contracts.length - 1] : null
    prof.carry = normalizeCarry(latest?.carry || {})
    prof.alCarry = Number(prof.alCarry || 0)

    return res.json({ profile: prof })
  } catch (e) {
    console.error('getProfileOne error', e)
    res.status(500).json({ message: 'Failed to load profile.' })
  }
}

exports.createProfileSingle = async (req, res) => {
  try {
    const body = req.body || {}

    const employeeId = pickEmployeeId(body)
    const managerId = pickManagerId(body)

    const joinDate = body.joinDate ? assertYMD(body.joinDate, 'joinDate') : ''
    let contractDate = body.contractDate ? assertYMD(body.contractDate, 'contractDate') : ''
    if (joinDate && !contractDate) contractDate = joinDate

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })
    if (!joinDate) return res.status(400).json({ message: 'joinDate is required.' })

    const semanticMode = validateModeAndChain({
      approvalMode: body.approvalMode,
      managerEmployeeIdOrLogin: managerId,
    })
    const storedMode = toStoredApprovalMode(semanticMode)

    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)
    const isActive = body.isActive !== false

    const empDir = await getDirectory(employeeId)
    const mgrDir = managerId ? await getDirectory(managerId) : null

    await ensureUser({
      loginId: employeeId,
      name: empDir?.name || body.name || employeeId,
      role: 'LEAVE_USER',
      isActive,
      telegramChatId: empDir?.telegramChatId || '',
      password: body.password, // optional, strong
    })

    if (managerId) {
      await ensureUser({
        loginId: managerId,
        name: mgrDir?.name || managerId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) {
      await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })
    }

    let prof = await LeaveProfile.findOne({ employeeId })
    const existed = !!prof
    if (!prof) prof = new LeaveProfile({ employeeId, employeeLoginId: employeeId })

    prof.approvalMode = storedMode
    prof.managerLoginId = managerId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

    prof.joinDate = joinDate
    prof.contractDate = contractDate
    prof.isActive = isActive

    prof.name = empDir?.name || prof.name || ''
    prof.department = empDir?.department || prof.department || ''

    // ✅ PER-CONTRACT carry on initial/latest contract
    const carry = body.carry !== undefined ? normalizeCarry(body.carry) : normalizeCarry({})

    // legacy fields (do not rely on these for logic)
    prof.carry = prof.carry || {} // keep for backward compat
    prof.alCarry = Number(body.alCarry || carry.AL || 0)

    ensureContracts(prof)
    const latest = pickLatestContract(prof)
    if (!latest) throw createError(500, 'Failed to initialize contract.')

    latest.carry = normalizeCarry(carry)

    // align pointers to latest contract
    prof.contractDate = latest.startDate || prof.contractDate
    prof.contractEndDate = latest.endDate || prof.contractEndDate
    prof.alCarry = Number(normalizeCarry(latest.carry).AL || 0) // legacy mirror

    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, existed ? 'leave:profile:updated' : 'leave:profile:created')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: semanticMode } })
  } catch (e) {
    console.error('createProfileSingle error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to create profile.' })
  }
}

exports.createManagerWithEmployees = async (req, res) => {
  try {
    const body = req.body || {}
    const rows = Array.isArray(body.employees) ? body.employees : []
    if (!rows.length) return res.status(400).json({ message: 'employees[] is required.' })

    const managerId = pickManagerId(body)

    const semanticMode = validateModeAndChain({
      approvalMode: body.approvalMode,
      managerEmployeeIdOrLogin: managerId,
    })
    const storedMode = toStoredApprovalMode(semanticMode)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)

    if (managerId) {
      const mgrDir = await getDirectory(managerId)
      await ensureUser({
        loginId: managerId,
        name: mgrDir?.name || managerId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) {
      await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })
    }

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
        password: r.password, // optional, strong
      })

      let prof = await LeaveProfile.findOne({ employeeId: empId })
      const existed = !!prof
      if (!prof) prof = new LeaveProfile({ employeeId: empId, employeeLoginId: empId })

      prof.approvalMode = storedMode
      prof.managerLoginId = managerId || ''
      prof.gmLoginId = gmLoginId
      prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

      prof.joinDate = joinDate
      prof.contractDate = contractDate
      prof.isActive = isActive

      prof.name = empDir?.name || prof.name || ''
      prof.department = empDir?.department || prof.department || ''

      const carry = r.carry !== undefined ? normalizeCarry(r.carry) : normalizeCarry({})

      // legacy mirrors only
      prof.alCarry = Number(r.alCarry || carry.AL || 0)

      ensureContracts(prof)
      const latest = pickLatestContract(prof)
      if (!latest) throw createError(500, 'Missing contract.')
      latest.carry = normalizeCarry(carry)

      prof.contractDate = latest.startDate || prof.contractDate
      prof.contractEndDate = latest.endDate || prof.contractEndDate
      prof.alCarry = Number(normalizeCarry(latest.carry).AL || 0)

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

exports.updateProfile = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    const body = req.body || {}

    if (body.joinDate !== undefined) prof.joinDate = assertYMD(body.joinDate, 'joinDate')
    if (body.isActive !== undefined) prof.isActive = body.isActive !== false

    // approval chain updates
    const nextManagerId =
      body.managerEmployeeId !== undefined || body.managerLoginId !== undefined ? pickManagerId(body) : s(prof.managerLoginId)

    const currentSemantic = toSemanticApprovalMode(prof.approvalMode)
    const nextSemantic = body.approvalMode !== undefined ? normalizeApprovalModeSemantic(body.approvalMode) : currentSemantic

    validateModeAndChain({ approvalMode: nextSemantic, managerEmployeeIdOrLogin: nextManagerId })

    const storedMode = toStoredApprovalMode(nextSemantic)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(nextSemantic)

    prof.approvalMode = storedMode
    prof.managerLoginId = nextManagerId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = nextSemantic === 'GM_AND_COO' ? cooLoginId : ''

    // ✅ contract pointers:
    // Allow admin to update contractDate only if you want to “change start date of current contract”.
    // If you do, we update latest contract start + end.
    ensureContracts(prof)
    const latest = pickLatestContract(prof)
    if (!latest) throw createError(500, 'Missing contract.')

    if (body.contractDate !== undefined) {
      const newStart = assertYMD(body.contractDate, 'contractDate')
      latest.startDate = newStart
      latest.endDate = endFromStartYMD(newStart)
      prof.contractDate = latest.startDate
      prof.contractEndDate = latest.endDate
    } else {
      // keep aligned anyway
      prof.contractDate = latest.startDate || prof.contractDate
      prof.contractEndDate = latest.endDate || prof.contractEndDate
    }

    // ✅ PER-CONTRACT carry update (current/latest contract)
    if (body.carry !== undefined) {
      latest.carry = normalizeCarry(body.carry)
    }

    // legacy mirror only
    if (body.alCarry !== undefined) {
      prof.alCarry = Number(body.alCarry || 0)
    } else if (body.carry !== undefined) {
      prof.alCarry = Number(normalizeCarry(latest.carry).AL || 0)
    }

    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: nextSemantic } })
  } catch (e) {
    console.error('updateProfile error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to update profile.' })
  }
}

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

exports.getContractHistory = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    res.json({ ok: true, employeeId, contracts: Array.isArray(prof.contracts) ? prof.contracts : [] })
  } catch (e) {
    console.error('getContractHistory error', e)
    res.status(500).json({ message: 'Failed to load contract history.' })
  }
}

exports.recalculateBalances = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    ensureContracts(prof)
    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: toSemanticApprovalMode(prof.approvalMode) } })
  } catch (e) {
    console.error('recalculateBalances error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to recalculate balances.' })
  }
}

/**
 * ✅ Renew contract:
 * - Close previous contract (snapshot balances + carry)
 * - Open new contract with its own carry
 *
 * Payload:
 *  {
 *    newContractDate: 'YYYY-MM-DD',
 *    note: '...optional...',
 *    clearUnusedAL: true|false,     // affects default carry logic (see below)
 *    carry: {AL,SP,MC,MA,UL}        // optional carry for NEW contract
 *  }
 *
 * Default NEW contract carry behavior (recommended):
 * - If body.carry provided => use it
 * - Else => start with ZERO carry, but if clearUnusedAL=false you can choose to copy forward
 *
 * Currently we do:
 * - If body.carry missing => carry-forward previous carry (optionally clear positive AL)
 * If you want "new contract starts with zero", change the marked section below.
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

    ensureContracts(prof)

    const last = pickLatestContract(prof)
    if (!last) throw createError(500, 'Missing last contract.')

    // close last if not closed
    if (!last.closedAt) {
      last.closedAt = new Date()
      last.closedBy = actorLoginId(req)
      last.note = last.note || 'Closed on renewal'
      last.closeSnapshot = {
        asOf: prof.balancesAsOf || null,
        balances: Array.isArray(prof.balances) ? prof.balances : [],
        contractDate: prof.contractDate || null,
        contractEndDate: prof.contractEndDate || null,
        carry: normalizeCarry(last.carry || {}),
      }
    }

    // decide new carry
    let nextCarry
    if (body.carry !== undefined) {
      nextCarry = normalizeCarry(body.carry)
    } else {
      // ✅ CURRENT DEFAULT: carry-forward previous contract carry
      nextCarry = normalizeCarry(last.carry || {})

      if (clearUnusedAL) {
        // clear positive AL only; keep negative debt
        if (Number(nextCarry.AL || 0) > 0) nextCarry.AL = 0
      }

      // ✅ If you want NEW contract always starts zero, use this instead:
      // nextCarry = normalizeCarry({})
      // (optional) keep debt only:
      // const prev = normalizeCarry(last.carry || {})
      // nextCarry.AL = Math.min(0, Number(prev.AL || 0))
    }

    // open new contract
    const nextNo = Number(last.contractNo || prof.contracts.length || 0) + 1
    const endDate = endFromStartYMD(newContractDate)

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
      carry: nextCarry, // ✅ per-contract carry
    })

    // align pointers to new contract
    prof.contractDate = newContractDate
    prof.contractEndDate = endDate

    // legacy mirror only
    prof.alCarry = Number(normalizeCarry(nextCarry).AL || 0)

    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: toSemanticApprovalMode(prof.approvalMode) } })
  } catch (e) {
    console.error('renewContract error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to renew contract.' })
  }
}

/**
 * ✅ Update carry for a specific contract number
 * PATCH /api/admin/leave/profiles/:employeeId/contracts/:contractNo
 * body: { carry: {AL,SP,MC,MA,UL} }
 *
 * Behavior:
 * - Updates that contract's carry
 * - If it is the active/latest contract => recompute balances (because UI shows current remaining)
 * - Always updates legacy mirror prof.alCarry if active contract carry changed
 */
exports.updateContractCarry = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    const contractNo = Number(req.params?.contractNo || 0)

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })
    if (!Number.isFinite(contractNo) || contractNo <= 0) {
      return res.status(400).json({ message: 'contractNo must be a positive number.' })
    }

    const prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    const body = req.body || {}
    if (body.carry === undefined) {
      return res.status(400).json({ message: 'carry is required.' })
    }

    ensureContracts(prof)

    const idx = (prof.contracts || []).findIndex((c) => Number(c?.contractNo || 0) === contractNo)
    if (idx < 0) return res.status(404).json({ message: `Contract #${contractNo} not found.` })

    const nextCarry = normalizeCarry(body.carry)
    prof.contracts[idx].carry = nextCarry

    // if this contract is the latest/active, align pointers and refresh balances
    const latest = pickLatestContract(prof)
    const isLatest = latest && Number(latest.contractNo || 0) === contractNo

    if (isLatest) {
      prof.contractDate = prof.contracts[idx].startDate || prof.contractDate
      prof.contractEndDate = prof.contracts[idx].endDate || prof.contractEndDate
      prof.alCarry = Number(nextCarry.AL || 0) // legacy mirror
      await syncBalancesForProfile(prof, nowYMD())
    }

    await prof.save()
    emitProfile(req, prof, 'leave:profile:updated')

    res.json({
      ok: true,
      employeeId,
      contractNo,
      carry: nextCarry,
      isLatest,
    })
  } catch (e) {
    console.error('updateContractCarry error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to update contract carry.' })
  }
}

/**
 * ✅ Admin password reset endpoint (optional)
 * POST /api/admin/leave/profiles/:employeeId/password
 * body: { password: "..." }
 */
exports.resetUserPassword = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    const password = req.body?.password

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const check = validateStrongPassword(password)
    if (!check.ok) return res.status(400).json({ message: check.message })

    const user = await User.findOne({ loginId: employeeId })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    user.passwordHash = await bcrypt.hash(String(password), 10)
    await user.save()

    res.json({ ok: true })
  } catch (e) {
    console.error('resetUserPassword error', e)
    res.status(e.status || 500).json({ message: e.message || 'Failed to reset password.' })
  }
}
