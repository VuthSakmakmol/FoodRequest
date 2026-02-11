/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

/* ───────────────── helpers ───────────────── */

const s = (v) => String(v ?? '').trim()
const up = (v) => s(v).toUpperCase()

const uniqUpper = (arr) =>
  [...new Set((arr || []).map((x) => up(x)).filter(Boolean))].filter(Boolean)

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  // supports old + new JWT payload shapes
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function actorEmployeeId(req) {
  // common payload shapes
  const emp = s(req.user?.employeeId || req.user?.empId || req.user?.employee || '')
  if (emp) return emp

  // In your system, loginId is often numeric and equals employeeId
  const loginId = actorLoginId(req)
  if (/^\d{4,}$/.test(loginId)) return loginId

  return ''
}

function hasAnyRole(req, roles) {
  const rr = getRoles(req)
  const want = uniqUpper(roles)
  return want.some((r) => rr.includes(r))
}

function pickEmpName(emp) {
  return (
    s(emp?.name) ||
    s(emp?.fullName) ||
    s(emp?.employeeName) ||
    s(`${emp?.firstName || ''} ${emp?.lastName || ''}`) ||
    ''
  ).trim()
}

/**
 * ✅ Normalize profile approvalMode into ONLY 3 modes:
 * - MANAGER_AND_GM
 * - MANAGER_AND_COO
 * - GM_AND_COO
 *
 * Supports legacy stored values:
 * - GM_ONLY         -> MANAGER_AND_GM
 * - GM_AND_COO      -> GM_AND_COO
 * - GM_OR_COO, GM_COO, COO_AND_GM, GM_THEN_COO -> GM_AND_COO
 */
function normalizeApprovalMode(v) {
  const raw = up(v)

  if (raw === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  if (raw === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  if (raw === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (raw === 'GM_AND_COO') return 'GM_AND_COO'

  const legacy = ['GM_OR_COO', 'GM_COO', 'COO_AND_GM', 'GM_THEN_COO']
  if (legacy.includes(raw)) return 'GM_AND_COO'

  // safest default
  return 'MANAGER_AND_GM'
}

async function findDirectoryByEmployeeId(employeeId) {
  const id = s(employeeId)
  if (!id) return null
  return EmployeeDirectory.findOne({ employeeId: id }).lean()
}

function sanitizeProfileForClient(profile) {
  if (!profile) return profile
  return {
    ...profile,
    approvalMode: normalizeApprovalMode(profile.approvalMode),
  }
}

/* ───────────────── core: self profile ───────────────── */

// GET /api/leave/user/profile
exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    if (!loginId && !employeeId) throw createError(401, 'Unauthorized')

    // ✅ Match by employeeId OR employeeLoginId
    const or = []
    if (employeeId) or.push({ employeeId })
    if (loginId) or.push({ employeeLoginId: loginId })
    // fallback: if loginId numeric, it may equal employeeId
    if (loginId && /^\d{4,}$/.test(loginId)) or.push({ employeeId: loginId })

    const profile = await LeaveProfile.findOne({ $or: or }).lean()
    if (!profile) throw createError(404, 'Leave profile not found')

    const dir = await findDirectoryByEmployeeId(profile.employeeId)

    return res.json({
      profile: sanitizeProfileForClient(profile),
      employee: dir
        ? {
            employeeId: s(dir.employeeId),
            name: pickEmpName(dir),
            department: s(dir.departmentName || dir.department || dir.dept),
            position: s(dir.position || dir.title),
            managerEmployeeId: s(dir.managerEmployeeId),
            managerName: s(dir.managerName),
          }
        : null,
    })
  } catch (err) {
    next(err)
  }
}

/* ───────────────── team listing for Manager / GM / COO ───────────────── */

// GET /api/leave/user/team/profiles
// Manager: profiles where profile.managerLoginId == actorLoginId
// GM:      profiles where profile.gmLoginId == actorLoginId
// COO:     profiles where profile.cooLoginId == actorLoginId
exports.getTeamLeaveProfiles = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(401, 'Unauthorized')

    const isManager = hasAnyRole(req, ['LEAVE_MANAGER', 'MANAGER', 'DEPT_MANAGER'])
    const isGm = hasAnyRole(req, ['LEAVE_GM', 'GM'])
    const isCoo = hasAnyRole(req, ['LEAVE_COO', 'COO'])

    if (!isManager && !isGm && !isCoo) throw createError(403, 'Not allowed')

    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'
    const qText = s(req.query.q)

    const filter = {}
    if (!includeInactive) filter.isActive = { $ne: false }

    // scope priority: COO > GM > Manager (if user has multiple roles)
    if (isCoo) filter.cooLoginId = loginId
    else if (isGm) filter.gmLoginId = loginId
    else filter.managerLoginId = loginId

    // optional search:
    // - if looks like id -> regex on employeeId
    // - else search directory -> map to employeeIds
    if (qText) {
      const looksId = /^[0-9A-Za-z_.-]+$/.test(qText)
      if (looksId) {
        filter.employeeId = { $regex: qText, $options: 'i' }
      } else {
        const dirs = await EmployeeDirectory.find({
          $or: [
            { name: { $regex: qText, $options: 'i' } },
            { fullName: { $regex: qText, $options: 'i' } },
            { firstName: { $regex: qText, $options: 'i' } },
            { lastName: { $regex: qText, $options: 'i' } },
            { department: { $regex: qText, $options: 'i' } },
            { dept: { $regex: qText, $options: 'i' } },
            { departmentName: { $regex: qText, $options: 'i' } },
          ],
        })
          .select('employeeId')
          .lean()

        const empIdsFromDir = (dirs || []).map((d) => s(d.employeeId)).filter(Boolean)
        filter.employeeId = { $in: empIdsFromDir.length ? empIdsFromDir : ['__NO_MATCH__'] }
      }
    }

    const profiles = await LeaveProfile.find(filter).sort({ employeeId: 1 }).lean()

    // attach directory info in batch
    const ids = (profiles || []).map((p) => s(p.employeeId)).filter(Boolean)
    const dirs = ids.length ? await EmployeeDirectory.find({ employeeId: { $in: ids } }).lean() : []
    const dirMap = new Map((dirs || []).map((d) => [s(d.employeeId), d]))

    const rows = (profiles || []).map((p) => {
      const d = dirMap.get(s(p.employeeId))
      const profile = sanitizeProfileForClient(p)

      return {
        employeeId: s(profile.employeeId),
        employeeLoginId: s(profile.employeeLoginId),
        isActive: profile.isActive !== false,
        joinDate: profile.joinDate || null,
        contractDate: profile.contractDate || null,
        contractEndDate: profile.contractEndDate || null,

        approvalMode: profile.approvalMode,
        managerLoginId: s(profile.managerLoginId),
        gmLoginId: s(profile.gmLoginId),
        cooLoginId: s(profile.cooLoginId),

        balances: Array.isArray(profile.balances) ? profile.balances : [],
        contracts: Array.isArray(profile.contracts) ? profile.contracts : [],

        employee: d
          ? {
              employeeId: s(d.employeeId),
              name: pickEmpName(d),
              department: s(d.departmentName || d.department || d.dept),
              position: s(d.position || d.title),
              managerEmployeeId: s(d.managerEmployeeId),
              managerName: s(d.managerName),
            }
          : null,
      }
    })

    return res.json({
      meta: {
        scope: isCoo ? 'COO' : isGm ? 'GM' : 'MANAGER',
        actor: loginId,
      },
      rows,
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/leave/user/team/profiles/:employeeId
// returns one profile (must be under manager/gm/coo scope)
exports.getTeamEmployeeProfile = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    if (!loginId) throw createError(401, 'Unauthorized')

    const isManager = hasAnyRole(req, ['LEAVE_MANAGER', 'MANAGER', 'DEPT_MANAGER'])
    const isGm = hasAnyRole(req, ['LEAVE_GM', 'GM'])
    const isCoo = hasAnyRole(req, ['LEAVE_COO', 'COO'])

    if (!isManager && !isGm && !isCoo) throw createError(403, 'Not allowed')

    const targetId = s(req.params.employeeId)
    if (!targetId) throw createError(400, 'employeeId is required')

    const scopeFilter = isCoo
      ? { cooLoginId: loginId }
      : isGm
        ? { gmLoginId: loginId }
        : { managerLoginId: loginId }

    const profile = await LeaveProfile.findOne({ employeeId: targetId, ...scopeFilter }).lean()
    if (!profile) throw createError(404, 'Leave profile not found (or not in your scope)')

    const dir = await findDirectoryByEmployeeId(targetId)

    return res.json({
      profile: sanitizeProfileForClient(profile),
      employee: dir
        ? {
            employeeId: s(dir.employeeId),
            name: pickEmpName(dir),
            department: s(dir.departmentName || dir.department || dir.dept),
            position: s(dir.position || dir.title),
            managerEmployeeId: s(dir.managerEmployeeId),
            managerName: s(dir.managerName),
          }
        : null,
    })
  } catch (err) {
    next(err)
  }
}
