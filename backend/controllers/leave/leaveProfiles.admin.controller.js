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
 */
const SEED_GM_LOGINID = String(process.env.LEAVE_GM_LOGINID || 'leave_gm').trim()
const SEED_COO_LOGINID = String(process.env.LEAVE_COO_LOGINID || 'leave_coo').trim()

/* ───────────────── helpers ───────────────── */

// Password
function isDigitsOnly(v) {
  return /^\d+$/.test(String(v || '').trim())
}

function formulaPassword(loginId) {
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
  return addDaysYMD(addYearsYMD(assertYMD(startYMD, 'contractStart'), 1), -1)
}

function actorLoginId(req) {
  return s(req.user?.loginId || req.user?.employeeId || req.user?.sub || req.user?.id || '')
}

/* ───────── approvalMode: semantic <-> stored enum (schema is GM_ONLY / GM_AND_COO) ───────── */

function normalizeApprovalModeSemantic(v) {
  const m = s(v).toUpperCase()
  if (m === 'GM_AND_COO') return 'GM_AND_COO'

  // backward compat inputs
  if (m === 'GM_OR_COO') return 'GM_AND_COO'

  // everything else becomes manager+gm (stored as GM_ONLY in schema)
  return 'MANAGER_AND_GM'
}

function toStoredApprovalMode(semanticMode) {
  const sem = normalizeApprovalModeSemantic(semanticMode)
  // your schema enum: GM_ONLY / GM_AND_COO
  return sem === 'GM_AND_COO' ? 'GM_AND_COO' : 'GM_ONLY'
}

function toSemanticApprovalMode(storedMode) {
  const m = s(storedMode).toUpperCase()
  return m === 'GM_AND_COO' ? 'GM_AND_COO' : 'MANAGER_AND_GM'
}

/* ───────── pickers (match your schema) ───────── */

function pickEmployeeId(obj) {
  return s(obj?.employeeId || obj?.employee?.employeeId || obj?.selectedEmployee?.employeeId || obj?.id || '')
}

function pickManagerLoginId(obj) {
  return s(obj?.managerLoginId || obj?.managerEmployeeId || obj?.manager?.employeeId || '')
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
  if (isDigitsOnly(id)) plainPwd = formulaPassword(id)
  else plainPwd = DEFAULT_PWD_POLICY === 'EMPLOYEE_ID' ? id : DEFAULT_PWD_POLICY

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

/* ───────── carry helpers (multi-type) ───────── */

function normalizeCarry(obj) {
  const base = obj && typeof obj === 'object' ? obj : {}
  const out = {}
  ;['AL', 'SP', 'MC', 'MA', 'UL'].forEach((k) => {
    out[k] = Number(base[k] || 0)
    if (!Number.isFinite(out[k])) out[k] = 0
  })
  return out
}

function carryFromProfile(doc) {
  // prefer new carry
  const c = normalizeCarry(doc?.carry || {})
  // legacy fallback: if carry.AL is 0 but alCarry has value, use it
  const legacy = Number(doc?.alCarry || 0)
  if (Number(c.AL || 0) === 0 && legacy !== 0) c.AL = legacy
  return c
}

function sameJSON(a, b) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

/**
 * ✅ Apply carry to balances:
 * - entitlement = entitlement + carry[type]
 * - remaining = max(0, entitlement - used)
 * - SP remaining capped by AL remaining (because SP consumes AL)
 * - UL entitlement stays 0 (we keep it 0 even if carry.UL exists)
 */
function applyCarryToBalances(balances = [], carry = {}) {
  const c = normalizeCarry(carry)
  const out = (balances || []).map((b) => ({ ...(b || {}) }))

  const getRow = (code) => out.find((x) => s(x.leaveTypeCode).toUpperCase() === code)

  const applyOne = (code) => {
    const row = getRow(code)
    if (!row) return
    if (code === 'UL') {
      row.yearlyEntitlement = 0
      row.remaining = 0
      return
    }

    const used = Number(row.used || 0)
    const baseEnt = Number(row.yearlyEntitlement || 0)
    const ent = baseEnt + Number(c[code] || 0)

    row.yearlyEntitlement = ent
    row.remaining = Math.max(0, ent - used)
  }

  // apply entitlement/remaining adjustments
  ;['AL', 'SP', 'MC', 'MA', 'UL'].forEach(applyOne)

  // SP remaining must be <= AL remaining (your SP consumes AL rule)
  const al = getRow('AL')
  const sp = getRow('SP')
  if (al && sp) {
    sp.remaining = Math.max(0, Math.min(Number(sp.remaining || 0), Number(al.remaining || 0)))
  }

  return out
}

/* ───────── balances sync ───────── */

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

  const raw = Array.isArray(snap?.balances) ? snap.balances : []
  const carry = carryFromProfile(doc)
  const nextBalances = applyCarryToBalances(raw, carry)

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

function validateModeAndChain({ approvalMode, managerLoginId }) {
  const semantic = normalizeApprovalModeSemantic(approvalMode)
  if (semantic === 'MANAGER_AND_GM') {
    if (!s(managerLoginId)) throw createError(400, 'Manager is required for Manager + GM mode.')
  }
  return semantic
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

      if (!doc.contractDate || !isValidYMD(doc.contractDate)) doc.contractDate = doc.joinDate
      ensureContractsInitialized(doc, actorLoginId(req))

      await syncBalancesForProfile(doc, asOf)

      if (doc.isModified()) {
        await doc.save()
        emitProfile(req, doc, 'leave:profile:updated')
      }
    }

    const fresh = await LeaveProfile.find(query).lean()

    // group by managerLoginId (matches your model)
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
        .map((x) => ({
          employeeId: s(x.employeeId),
          name: x.name || '',
          department: x.department || '',
          joinDate: x.joinDate || null,
          contractDate: x.contractDate || null,
          contractEndDate: x.contractEndDate || null,

          managerLoginId: s(x.managerLoginId),
          gmLoginId: s(x.gmLoginId),
          cooLoginId: s(x.cooLoginId),

          approvalMode: toSemanticApprovalMode(x.approvalMode),

          isActive: x.isActive !== false,
          balances: Array.isArray(x.balances) ? x.balances : [],
          contracts: Array.isArray(x.contracts) ? x.contracts : [],
          balancesAsOf: x.balancesAsOf || null,

          // ✅ carry (new + legacy)
          carry: normalizeCarry(x.carry || {}),
          alCarry: Number(x.alCarry || 0),
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

exports.getProfileOne = async (req, res) => {
  try {
    const employeeId = s(req.params?.employeeId)
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    prof.approvalMode = toSemanticApprovalMode(prof.approvalMode)
    prof.carry = normalizeCarry(prof.carry || {})
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
    const managerLoginId = pickManagerLoginId(body)

    const joinDate = body.joinDate ? assertYMD(body.joinDate, 'joinDate') : ''
    let contractDate = body.contractDate ? assertYMD(body.contractDate, 'contractDate') : ''
    if (joinDate && !contractDate) contractDate = joinDate

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })
    if (!joinDate) return res.status(400).json({ message: 'joinDate is required.' })

    const semanticMode = validateModeAndChain({ approvalMode: body.approvalMode, managerLoginId })
    const storedMode = toStoredApprovalMode(semanticMode)

    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)
    const isActive = body.isActive !== false

    const empDir = await getDirectory(employeeId)
    const mgrDir = managerLoginId ? await getDirectory(managerLoginId) : null

    await ensureUser({
      loginId: employeeId,
      name: empDir?.name || body.name || employeeId,
      role: 'LEAVE_USER',
      isActive,
      telegramChatId: empDir?.telegramChatId || '',
    })

    if (managerLoginId) {
      await ensureUser({
        loginId: managerLoginId,
        name: mgrDir?.name || managerLoginId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })

    let prof = await LeaveProfile.findOne({ employeeId })
    const existed = !!prof
    if (!prof) prof = new LeaveProfile({ employeeId, employeeLoginId: employeeId })

    prof.approvalMode = storedMode
    prof.managerLoginId = managerLoginId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

    prof.joinDate = joinDate
    prof.contractDate = contractDate
    prof.isActive = isActive

    // ✅ carry support (new + legacy)
    if (body.carry !== undefined) prof.carry = normalizeCarry(body.carry)
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

    // ✅ carry update
    if (body.carry !== undefined) prof.carry = normalizeCarry(body.carry)
    if (body.alCarry !== undefined) prof.alCarry = Number(body.alCarry || 0)

    const nextManagerLoginId =
      body.managerLoginId !== undefined || body.managerEmployeeId !== undefined
        ? pickManagerLoginId(body)
        : s(prof.managerLoginId)

    const currentSemantic = toSemanticApprovalMode(prof.approvalMode)
    const nextSemantic = body.approvalMode !== undefined ? normalizeApprovalModeSemantic(body.approvalMode) : currentSemantic

    validateModeAndChain({ approvalMode: nextSemantic, managerLoginId: nextManagerLoginId })

    const storedMode = toStoredApprovalMode(nextSemantic)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(nextSemantic)

    prof.approvalMode = storedMode
    prof.managerLoginId = nextManagerLoginId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = nextSemantic === 'GM_AND_COO' ? cooLoginId : ''

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

exports.createManagerWithEmployees = async (req, res) => {
  try {
    const body = req.body || {}
    const rows = Array.isArray(body.employees) ? body.employees : []
    if (!rows.length) return res.status(400).json({ message: 'employees[] is required.' })

    const managerLoginId = pickManagerLoginId(body)

    const semanticMode = validateModeAndChain({ approvalMode: body.approvalMode, managerLoginId })
    const storedMode = toStoredApprovalMode(semanticMode)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(semanticMode)

    if (managerLoginId) {
      const mgrDir = await getDirectory(managerLoginId)
      await ensureUser({
        loginId: managerLoginId,
        name: mgrDir?.name || managerLoginId,
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
      prof.managerLoginId = managerLoginId || ''
      prof.gmLoginId = gmLoginId
      prof.cooLoginId = semanticMode === 'GM_AND_COO' ? cooLoginId : ''

      prof.joinDate = joinDate
      prof.contractDate = contractDate
      prof.isActive = isActive

      // ✅ carry per employee row
      if (r.carry !== undefined) prof.carry = normalizeCarry(r.carry)
      if (r.alCarry !== undefined) prof.alCarry = Number(r.alCarry || 0)

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

    ensureContractsInitialized(prof, actorLoginId(req))
    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    emitProfile(req, prof, 'leave:profile:updated')
    res.json({ ok: true, profile: { ...prof.toObject(), approvalMode: toSemanticApprovalMode(prof.approvalMode) } })
  } catch (e) {
    console.error('recalculateBalances error', e)
    res.status(e.status || 400).json({ message: e.message || 'Failed to recalculate balances.' })
  }
}

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

    const last = prof.contracts[prof.contracts.length - 1]
    if (last && !last.closedAt) {
      last.closedAt = new Date()
      last.closedBy = actorLoginId(req)
      last.note = last.note || 'Closed on renewal'
      last.closeSnapshot = {
        asOf: prof.balancesAsOf || null,
        balances: Array.isArray(prof.balances) ? prof.balances : [],
        contractDate: prof.contractDate || null,
        contractEndDate: prof.contractEndDate || null,

        // ✅ snapshot carry
        carry: normalizeCarry(prof.carry || {}),
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
      if (prof.carry && typeof prof.carry.AL === 'number' && Number(prof.carry.AL) > 0) prof.carry.AL = 0
      if (typeof prof.alCarry === 'number' && Number(prof.alCarry) > 0) prof.alCarry = 0
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

function validateStrongPassword(pwd) {
  const p = String(pwd || '')
  if (p.length < 13) return { ok: false, message: 'Password must be at least 13 characters.' }

  // simple strong rules (you can adjust)
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

