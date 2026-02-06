/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function uniq(arr) {
  return [...new Set((arr || []).map((x) => s(x)).filter(Boolean))]
}

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniq([...raw, ...base]).map((x) => up(x))
}

async function resolveEmployeeIdFromAuth(req) {
  // best-effort from token
  const employeeId = s(req.user?.employeeId)
  if (employeeId) return employeeId

  // try loginId -> EmployeeDirectory
  const loginId = s(req.user?.loginId || req.user?.id || req.user?.sub)
  if (!loginId) return ''

  const emp =
    (await EmployeeDirectory.findOne({ loginId }).lean()) ||
    (await EmployeeDirectory.findOne({ employeeId: loginId }).lean())

  return s(emp?.employeeId)
}

function actorLoginId(req) {
  // supports old + new payload shapes
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function pickContractId(c) {
  return s(c?._id || c?.id || '')
}

function mapContractForSelector(c) {
  // Support both your schema styles:
  // - { startDate, endDate }
  // - { from, to }
  const from = s(c?.startDate || c?.from || '')
  const to = s(c?.endDate || c?.to || '')

  return {
    _id: pickContractId(c),
    from,
    to,
    note: s(c?.note || c?.closeSnapshot?.note || ''),
    closeSnapshot: c?.closeSnapshot || null,
  }
}

async function loadManagerCard(prof) {
  let manager = null
  const managerEmployeeId = s(prof.managerEmployeeId)
  const managerLoginId = s(prof.managerLoginId)

  if (managerEmployeeId || managerLoginId) {
    const mgr =
      (managerEmployeeId
        ? await EmployeeDirectory.findOne({ employeeId: managerEmployeeId }).lean()
        : null) ||
      (managerLoginId ? await EmployeeDirectory.findOne({ loginId: managerLoginId }).lean() : null)

    if (mgr) {
      manager = {
        employeeId: s(mgr.employeeId),
        loginId: s(mgr.loginId),
        name: s(mgr.name || mgr.fullName),
        department: s(mgr.department || mgr.departmentName),
      }
    }
  }
  return manager
}

/**
 * ✅ GET /api/leave/user/profile/managed
 * Returns employees under current manager (by managerLoginId matching manager's loginId OR employeeId)
 */
exports.getManagedProfiles = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    // optional strict role gate (recommended)
    if (!roles.includes('LEAVE_MANAGER') && !roles.includes('MANAGER') && !roles.includes('LEAVE_ADMIN')) {
      // if you want to allow everyone to call, remove this block
      // but your UI calls this only for managers.
      return res.json({ rows: [] })
    }

    const myLoginId = actorLoginId(req)
    const myEmployeeId = await resolveEmployeeIdFromAuth(req)

    const keys = uniq([myLoginId, myEmployeeId])
    if (!keys.length) throw createError(401, 'Unauthorized (missing loginId/employeeId)')

    // In your LeaveProfile schema you use managerLoginId (string)
    const docs = await LeaveProfile.find({
      isActive: { $ne: false },
      managerLoginId: { $in: keys },
    })
      .select('employeeId name department joinDate contractDate contractEndDate isActive managerLoginId')
      .sort({ employeeId: 1 })
      .lean()

    // return in the exact structure your UI expects
    const rows = (docs || []).map((p) => ({
      employeeId: s(p.employeeId),
      name: s(p.name),
      department: s(p.department),
      joinDate: p.joinDate || null,
      contractDate: p.contractDate || null,
      contractEndDate: p.contractEndDate || null,
      managerLoginId: s(p.managerLoginId),
      isActive: p.isActive !== false,
    }))

    return res.json({ rows })
  } catch (err) {
    return next(err)
  }
}

/**
 * ✅ GET /api/leave/user/profile/my
 * - Self view: /my
 * - Manager view: /my?employeeId=xxxxx  (only if employee is under me)
 */
exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const myEmployeeId = await resolveEmployeeIdFromAuth(req)
    const myLoginId = actorLoginId(req)
    if (!myEmployeeId && !myLoginId) throw createError(401, 'Unauthorized (missing identity)')

    const targetEmployeeId = s(req.query.employeeId) || myEmployeeId

    // load target profile
    const prof = await LeaveProfile.findOne({ employeeId: targetEmployeeId }).lean()
    if (!prof) throw createError(404, 'Not found')

    // If viewing someone else => must be their manager (or admin)
    if (targetEmployeeId !== myEmployeeId) {
      const roles = getRoles(req)
      const isAdmin = roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
      if (!isAdmin) {
        const keys = uniq([myLoginId, myEmployeeId])
        const ok = keys.includes(s(prof.managerLoginId))
        if (!ok) throw createError(403, 'Forbidden (not your employee)')
      }
    }

    const contractId = s(req.query.contractId)

    // contracts dropdown meta
    const contracts = Array.isArray(prof.contracts) ? prof.contracts : []
    const metaContracts = contracts.map(mapContractForSelector)

    // optional contract snapshot view
    const selected = contractId ? contracts.find((c) => pickContractId(c) === contractId) : null

    // balances:
    // - if selected contract has closeSnapshot.balances, show that
    // - else show live prof.balances
    let balances = Array.isArray(prof.balances) ? prof.balances : []
    let carry = prof.carry && typeof prof.carry === 'object' ? prof.carry : {}

    const snapBalances = selected?.closeSnapshot?.balances
    const snapCarry = selected?.closeSnapshot?.carry

    if (Array.isArray(snapBalances) && snapBalances.length) balances = snapBalances
    if (snapCarry && typeof snapCarry === 'object') carry = snapCarry

    const manager = await loadManagerCard(prof)

    return res.json({
      profile: {
        employeeId: s(prof.employeeId),
        loginId: s(prof.loginId || ''),
        name: s(prof.name),
        department: s(prof.department),
        joinDate: s(prof.joinDate),
        contractDate: s(prof.contractDate),
        contractEndDate: s(prof.contractEndDate),
        approvalMode: up(prof.approvalMode),
        isActive: prof.isActive !== false,

        manager,
        carry,
        balances,

        // keep contracts if UI needs it
        contracts,
      },
      meta: {
        updatedAt: new Date().toISOString(),
        contracts: metaContracts,
      },
    })
  } catch (err) {
    return next(err)
  }
}
/**
 * ✅ GET /api/leave/user/profile/gm-managed
 * Returns employees assigned to this GM AND only in Manager+GM mode (stored = GM_ONLY)
 */
exports.getGmManagedProfiles = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    if (!roles.includes('LEAVE_GM') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      return res.json({ rows: [] })
    }

    const myLoginId = actorLoginId(req)
    if (!myLoginId) return res.status(401).json({ message: 'Unauthorized (missing loginId)' })

    // ✅ Manager+GM mode is stored as GM_ONLY
    const docs = await LeaveProfile.find({
      isActive: { $ne: false },
      gmLoginId: myLoginId,
      approvalMode: 'GM_ONLY',
    })
      .select('employeeId name department joinDate contractDate contractEndDate isActive managerLoginId gmLoginId approvalMode')
      .sort({ employeeId: 1 })
      .lean()

    const rows = (docs || []).map((p) => ({
      employeeId: s(p.employeeId),
      name: s(p.name),
      department: s(p.department),
      joinDate: p.joinDate || null,
      contractDate: p.contractDate || null,
      contractEndDate: p.contractEndDate || null,
      managerLoginId: s(p.managerLoginId),
      gmLoginId: s(p.gmLoginId),
      approvalMode: up(p.approvalMode) === 'GM_ONLY' ? 'MANAGER_AND_GM' : 'GM_AND_COO', // nice for UI
      isActive: p.isActive !== false,
    }))

    return res.json({ rows })
  } catch (err) {
    return next(err)
  }
}
