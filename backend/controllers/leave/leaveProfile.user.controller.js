/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

// Use whichever you already use in your project:
const { computeBalances } = require('../../utils/leave.rules')

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
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

function pickContractId(c) {
  return s(c?._id || c?.id || '')
}

function mapContractForSelector(c) {
  // keep small (for dropdown)
  return {
    _id: pickContractId(c),
    from: s(c?.from),
    to: s(c?.to),
    note: s(c?.note || c?.closeSnapshot?.note || ''),
    // optional snapshots if you store them
    closeSnapshot: c?.closeSnapshot || null,
    balances: Array.isArray(c?.balances) ? c.balances : undefined,
    carry: c?.carry || undefined,
  }
}

// GET /api/leave/user/profile?contractId=xxxx
exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const myEmployeeId = await resolveEmployeeIdFromAuth(req)
    if (!myEmployeeId) throw createError(401, 'Unauthorized (missing employeeId)')

    const contractId = s(req.query.contractId)

    const prof = await LeaveProfile.findOne({ employeeId: myEmployeeId }).lean()
    if (!prof) throw createError(404, 'Not found')

    // manager lookup (only my manager)
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
          department: s(mgr.department),
        }
      }
    }

    // build meta.contracts for dropdown
    const contracts = Array.isArray(prof.contracts) ? prof.contracts : []
    const metaContracts = contracts.map(mapContractForSelector)

    // choose view contract (optional)
    const selected =
      contractId &&
      contracts.find((c) => pickContractId(c) === contractId)

    // balances:
    // - If selected contract has snapshot balances, show those
    // - else show live prof.balances
    let balances = Array.isArray(prof.balances) ? prof.balances : []
    let carry = prof.carry && typeof prof.carry === 'object' ? prof.carry : {}

    const snapshotBalances =
      selected?.closeSnapshot?.balances ||
      selected?.balances ||
      null

    const snapshotCarry =
      selected?.closeSnapshot?.carry ||
      selected?.carry ||
      null

    if (Array.isArray(snapshotBalances) && snapshotBalances.length) {
      balances = snapshotBalances
    }
    if (snapshotCarry && typeof snapshotCarry === 'object') {
      carry = snapshotCarry
    }

    // IMPORTANT: ensure balances are computed the same as admin (if your admin uses computeBalances)
    // If your LeaveProfile already stores computed balances, this won't change anything.
    // If you want it identical to admin, keep this:
    try {
      balances = computeBalances({
        profile: prof,
        // allow override if viewing snapshot
        overrideBalances: balances,
        overrideCarry: carry,
      })
    } catch (e) {
      // if your computeBalances signature is different, it will throw — we keep existing balances
      // console.warn('computeBalances skipped:', e.message)
    }

    const payload = {
      profile: {
        employeeId: s(prof.employeeId),
        loginId: s(prof.loginId || req.user?.loginId),
        name: s(prof.name),
        department: s(prof.department),
        joinDate: s(prof.joinDate),
        contractDate: s(prof.contractDate),
        contractEndDate: s(prof.contractEndDate),
        approvalMode: up(prof.approvalMode),
        isActive: prof.isActive !== false,

        manager, // ✅ only my manager
        carry,
        balances,
        // keep contracts too if your UI needs it
        contracts,
      },
      meta: {
        updatedAt: new Date().toISOString(),
        contracts: metaContracts,
      },
    }

    return res.json(payload)
  } catch (err) {
    return next(err)
  }
}
