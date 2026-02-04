/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const { computeBalances } = require('../../utils/leave.rules')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const PP_OFFSET_MINUTES = 7 * 60 // UTC+7

/* ───────────────── helpers ───────────────── */

const s = (v) => String(v ?? '').trim()

const uniqUpper = (arr) =>
  [...new Set((arr || []).map((x) => String(x || '').toUpperCase().trim()))].filter(Boolean)

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  // supports old + new JWT payload shapes
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function isDigitsOnly(v) {
  return /^\d+$/.test(s(v))
}

/**
 * Prefer employeeId from token.
 * If missing, fallback to loginId ONLY when it looks like employeeId (digits).
 */
function actorEmployeeId(req) {
  const emp = s(req.user?.employeeId || '')
  if (emp) return emp

  const login = actorLoginId(req)
  return isDigitsOnly(login) ? login : ''
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}

function assertYMD(v, label = 'date') {
  const val = s(v)
  if (!isValidYMD(val)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD, got "${v}"`)
  return val
}

/** Convert Date/ISO/string to YYYY-MM-DD (UTC). Returns '' if invalid. */
function toYMD(v) {
  if (!v) return ''
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return ''
    if (isValidYMD(t)) return t
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  try {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

/**
 * Phnom Penh "today" as YYYY-MM-DD (no dayjs)
 */
function nowYMD(tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce((acc, p) => {
      acc[p.type] = p.value
      return acc
    }, {})

  return `${parts.year}-${parts.month}-${parts.day}`
}

/**
 * Phnom Penh midnight Date for a YMD (prevents timezone drift).
 * PP 00:00 == UTC previous day 17:00.
 */
function phnomPenhMidnightDate(ymd) {
  const d = s(ymd)
  if (!isValidYMD(d)) return new Date()
  const [y, m, day] = d.split('-').map(Number)
  const utcMidnight = Date.UTC(y, (m || 1) - 1, day || 1, 0, 0, 0)
  const ppMidnightUtc = utcMidnight - PP_OFFSET_MINUTES * 60 * 1000
  return new Date(ppMidnightUtc)
}

/** ✅ support old numeric employeeId data + new string employeeId */
function buildEmpIdIn(employeeId) {
  const id = s(employeeId)
  if (!id) return { $in: [] }
  const n = Number(id)
  const list = [id]
  if (Number.isFinite(n)) list.push(n)
  return { $in: [...new Set(list)] }
}

/* ───────── approvalMode normalization (profile schema: GM_ONLY / GM_AND_COO) ───────── */

function toSemanticApprovalMode(storedMode) {
  const m = s(storedMode).toUpperCase()
  return m === 'GM_AND_COO' ? 'GM_AND_COO' : 'MANAGER_AND_GM'
}

/* ───────── carry logic (match admin concept) ───────── */

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
  const c = normalizeCarry(doc?.carry || {})
  const legacy = Number(doc?.alCarry || 0)
  if (Number(c.AL || 0) === 0 && legacy !== 0) c.AL = legacy
  return c
}

/**
 * Apply carry to balances:
 * - entitlement = entitlement + carry[type]
 * - remaining = max(0, entitlement - used)
 * - SP remaining capped by AL remaining (SP consumes AL)
 * - UL stays 0
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

  ;['AL', 'SP', 'MC', 'MA', 'UL'].forEach(applyOne)

  // SP remaining must be <= AL remaining
  const al = getRow('AL')
  const sp = getRow('SP')
  if (al && sp) {
    sp.remaining = Math.max(0, Math.min(Number(sp.remaining || 0), Number(al.remaining || 0)))
  }

  return out
}

/* ───────── contract meta helpers ───────── */

function pickContract(profile, { contractId, contractNo }) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  if (!list.length) return null
  if (contractId) return list.find((c) => String(c._id) === String(contractId)) || null
  if (contractNo) return list.find((c) => Number(c.contractNo) === Number(contractNo)) || null
  return null
}

function getCurrentContract(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  if (!list.length) return null
  const open = list.filter((c) => !c.closedAt)
  return (open.length ? open : list).sort((a, b) => Number(a.contractNo) - Number(b.contractNo)).pop()
}

function contractMeta(contract) {
  if (!contract) return null
  return {
    contractId: String(contract._id),
    contractNo: contract.contractNo,
    startDate: contract.startDate,
    endDate: contract.endDate,
    closedAt: contract.closedAt || null,
  }
}

function listContractsMeta(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  const current = getCurrentContract(profile)
  return list.map((c) => ({
    contractId: String(c._id),
    contractNo: c.contractNo,
    startDate: c.startDate,
    endDate: c.endDate,
    closedAt: c.closedAt || null,
    isCurrent: current && String(current._id) === String(c._id),
    label: `Contract ${c.contractNo}: ${c.startDate}${c.endDate ? ` → ${c.endDate}` : ''}`,
  }))
}

/* ───────── permissions ───────── */

function isAdminLike(roles) {
  const set = new Set(roles || [])
  return set.has('ADMIN') || set.has('ROOT_ADMIN') || set.has('LEAVE_ADMIN')
}

/**
 * - Self: always allowed (employeeId matches my employeeId OR my numeric loginId)
 * - Admin: allowed
 * - Manager/GM/COO: allowed if target profile points to me (managerLoginId/gmLoginId/cooLoginId)
 *
 * Approver fields might contain employeeId OR loginId, so check both meLoginId and meEmployeeId.
 */
function canViewProfile({ roles, meLoginId, meEmployeeId, profile, targetEmployeeId }) {
  const meA = s(meLoginId)
  const meB = s(meEmployeeId)
  const target = s(targetEmployeeId)

  // ✅ self allowed
  if (target && (target === meA || target === meB)) return true

  // ✅ admins can view anything
  if (isAdminLike(roles)) return true

  const mgr = s(profile?.managerLoginId)
  const gm = s(profile?.gmLoginId)
  const coo = s(profile?.cooLoginId)

  const isMe = (v) => v && (v === meA || v === meB)

  if (roles.includes('LEAVE_MANAGER')) return isMe(mgr)
  if (roles.includes('LEAVE_GM')) return isMe(gm)
  if (roles.includes('LEAVE_COO')) return isMe(coo)

  // leave users cannot view others
  if (roles.includes('LEAVE_USER')) return false

  return false
}

/* ───────── data loaders ───────── */

async function getApprovedRequests(employeeId) {
  const emp = s(employeeId)
  if (!emp) return []
  return LeaveRequest.find({ employeeId: buildEmpIdIn(emp), status: 'APPROVED' })
    .sort({ startDate: 1, createdAt: 1 })
    .lean()
}

/* ───────────────── controllers ───────────────── */

/**
 * GET /api/leave/profile/my
 *
 * Query:
 *  - employeeId (optional)  -> for approvers/admin viewing others
 *  - asOf (optional YYYY-MM-DD) -> default today (PP)
 *  - contractId / contractNo (optional) -> return meta.selectedContract
 *
 * Returns:
 *  - profile (lean base fields)
 *  - balances computed (approved only) + carry applied
 *  - approvalMode semantic
 *  - contract meta + contracts list
 *
 * ✅ read-only (no save). Frontend refreshes via realtime events.
 */
exports.getMyProfile = async (req, res) => {
  try {
    const roles = getRoles(req)
    const meLoginId = actorLoginId(req)
    const meEmployeeId = actorEmployeeId(req)

    if (!meLoginId) return res.status(401).json({ message: 'Unauthorized' })

    const targetEmployeeIdRaw = s(req.query.employeeId)
    const targetEmployeeId = targetEmployeeIdRaw || meEmployeeId || (isDigitsOnly(meLoginId) ? meLoginId : '')
    if (!targetEmployeeId) {
      return res.status(400).json({
        message: 'Missing employeeId. Your token must include employeeId or use a numeric loginId.',
      })
    }

    // load profile (support numeric stored employeeId too)
    const prof =
      (await LeaveProfile.findOne({ employeeId: targetEmployeeId }).lean()) ||
      (await LeaveProfile.findOne({ employeeId: Number(targetEmployeeId) }).lean())

    if (!prof) return res.status(404).json({ message: 'Profile not found.' })

    const ok = canViewProfile({
      roles,
      meLoginId,
      meEmployeeId,
      profile: prof,
      targetEmployeeId,
    })
    if (!ok) return res.status(403).json({ message: 'Forbidden' })

    // asOf
    const asOf = req.query.asOf ? assertYMD(req.query.asOf, 'asOf') : nowYMD()
    const asOfDate = phnomPenhMidnightDate(asOf)

    const approved = await getApprovedRequests(targetEmployeeId)

    // compute snapshot
    const snap = computeBalances(prof, approved, asOfDate)

    const rawBalances = Array.isArray(snap?.balances)
      ? snap.balances
      : Array.isArray(prof.balances)
        ? prof.balances
        : []

    // ✅ apply carry same idea as admin
    const carry = carryFromProfile(prof)
    const balances = applyCarryToBalances(rawBalances, carry)

    // contract meta
    const requested = pickContract(prof, { contractId: s(req.query.contractId), contractNo: s(req.query.contractNo) })
    const current = getCurrentContract(prof)
    const selectedContract = requested || current

    return res.json({
      profile: {
        ...prof,
        employeeId: s(prof.employeeId),
        managerLoginId: s(prof.managerLoginId),
        gmLoginId: s(prof.gmLoginId),
        cooLoginId: s(prof.cooLoginId),

        // ✅ semantic mode for UI
        approvalMode: toSemanticApprovalMode(prof.approvalMode),

        // ✅ normalize carry fields
        carry: normalizeCarry(prof.carry || {}),
        alCarry: Number(prof.alCarry || 0),

        // ✅ computed fields
        balances,
        balancesAsOf: asOf,
        meta: snap?.meta || null,

        // ✅ contract helpers for UI
        contract: contractMeta(selectedContract),
        contracts: listContractsMeta(prof),
      },
    })
  } catch (e) {
    console.error('getMyProfile error', e)
    return res.status(500).json({ message: e.message || 'Failed to load profile.' })
  }
}

/**
 * GET /api/leave/profile/managed
 *
 * Query:
 *  - includeInactive=1 (admin only; default active)
 *  - withBalances=1 (optional; compute balances per employee)  ⚠️ heavier
 *  - asOf=YYYY-MM-DD (optional for withBalances)
 *
 * Behavior:
 *  - ADMIN/LEAVE_ADMIN: all profiles (active by default)
 *  - GM: profiles where gmLoginId matches me (loginId OR employeeId)
 *  - COO: profiles where cooLoginId matches me (loginId OR employeeId)
 *  - MANAGER: profiles where managerLoginId matches me (loginId OR employeeId)
 */
exports.listManagedProfiles = async (req, res) => {
  try {
    const roles = getRoles(req)
    const meLoginId = actorLoginId(req)
    const meEmployeeId = actorEmployeeId(req)

    if (!meLoginId) return res.status(401).json({ message: 'Unauthorized' })

    const includeInactive = s(req.query.includeInactive) === '1'
    const withBalances = s(req.query.withBalances) === '1'

    const query = includeInactive ? {} : { isActive: { $ne: false } }

    if (isAdminLike(roles)) {
      // all (respect includeInactive)
    } else if (roles.includes('LEAVE_GM')) {
      query.$or = [{ gmLoginId: meLoginId }, { gmLoginId: meEmployeeId }]
    } else if (roles.includes('LEAVE_COO')) {
      query.$or = [{ cooLoginId: meLoginId }, { cooLoginId: meEmployeeId }]
    } else if (roles.includes('LEAVE_MANAGER')) {
      query.$or = [{ managerLoginId: meLoginId }, { managerLoginId: meEmployeeId }]
    } else {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const rows = await LeaveProfile.find(query)
      .sort({ employeeId: 1 })
      .lean()

    if (!withBalances) {
      // light response for inbox lists
      return res.json(
        (rows || []).map((p) => ({
          employeeId: s(p.employeeId),
          name: p.name || '',
          department: p.department || '',
          joinDate: p.joinDate || null,
          contractDate: p.contractDate || null,
          contractEndDate: p.contractEndDate || null,

          managerLoginId: s(p.managerLoginId),
          gmLoginId: s(p.gmLoginId),
          cooLoginId: s(p.cooLoginId),
          approvalMode: toSemanticApprovalMode(p.approvalMode),

          isActive: p.isActive !== false,

          // optional contract list (useful for UI)
          contract: contractMeta(getCurrentContract(p)),
          contracts: listContractsMeta(p),
        }))
      )
    }

    // heavy: compute balances per employee
    const asOf = req.query.asOf ? assertYMD(req.query.asOf, 'asOf') : nowYMD()
    const asOfDate = phnomPenhMidnightDate(asOf)

    const out = []
    for (const p of rows || []) {
      const empId = s(p.employeeId)
      if (!empId) continue

      const approved = await getApprovedRequests(empId)
      const snap = computeBalances(p, approved, asOfDate)

      const rawBalances = Array.isArray(snap?.balances) ? snap.balances : []
      const carry = carryFromProfile(p)
      const balances = applyCarryToBalances(rawBalances, carry)

      out.push({
        employeeId: empId,
        name: p.name || '',
        department: p.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        contractEndDate: p.contractEndDate || null,

        managerLoginId: s(p.managerLoginId),
        gmLoginId: s(p.gmLoginId),
        cooLoginId: s(p.cooLoginId),
        approvalMode: toSemanticApprovalMode(p.approvalMode),

        isActive: p.isActive !== false,
        balances,
        balancesAsOf: asOf,
        meta: snap?.meta || null,

        carry: normalizeCarry(p.carry || {}),
        alCarry: Number(p.alCarry || 0),

        contract: contractMeta(getCurrentContract(p)),
        contracts: listContractsMeta(p),
      })
    }

    return res.json(out)
  } catch (e) {
    console.error('listManagedProfiles error', e)
    return res.status(500).json({ message: e.message || 'Failed to load employees.' })
  }
}
