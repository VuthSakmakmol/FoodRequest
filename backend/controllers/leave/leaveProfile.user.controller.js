/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const createError = require('http-errors')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

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

function actorEmployeeId(req) {
  // common payload shapes
  const emp = s(req.user?.employeeId || req.user?.empId || req.user?.employee || '')
  if (emp) return emp

  // ✅ IMPORTANT FIX:
  // In your system, user loginId is often numeric and equals employeeId
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

async function findDirectoryByEmployeeId(employeeId) {
  const id = s(employeeId)
  if (!id) return null
  return EmployeeDirectory.findOne({ employeeId: id }).lean()
}

/* ───────────────── core: self profile ───────────────── */

// GET /api/leave/user/profile
exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    if (!loginId && !employeeId) throw createError(401, 'Unauthorized')

    // Helpful debug while integrating (remove if you want)
    // console.log('JWT user:', req.user)
    // console.log('actorLoginId:', loginId)
    // console.log('actorEmployeeId:', employeeId)

    // ✅ Match by either loginId or employeeId
    const q = {
      $or: [
        loginId ? { loginId } : null,
        employeeId ? { employeeId } : null,
      ].filter(Boolean),
    }

    const profile = await LeaveProfile.findOne(q).lean()
    if (!profile) throw createError(404, 'Leave profile not found')

    // Attach directory info (best effort)
    const dir = await findDirectoryByEmployeeId(profile.employeeId)

    res.json({
      profile,
      employee: dir
        ? {
            employeeId: s(dir.employeeId),
            name: pickEmpName(dir),
            department: s(dir.department || dir.dept),
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

/* ───────────────── team listing for Manager / GM ───────────────── */

// GET /api/leave/user/team/profiles
// Manager: profiles where profile.managerEmployeeId == actorEmployeeId
// GM: profiles where profile.gmLoginId == actorLoginId
exports.getTeamLeaveProfiles = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    const isManager = hasAnyRole(req, ['MANAGER', 'LEAVE_MANAGER', 'DEPT_MANAGER'])
    const isGm = hasAnyRole(req, ['GM', 'LEAVE_GM'])

    if (!isManager && !isGm) throw createError(403, 'Not allowed')

    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'
    const qText = s(req.query.q)

    const filter = {}
    if (!includeInactive) filter.isActive = { $ne: false }

    // scope
    if (isGm) {
      if (!loginId) throw createError(401, 'Unauthorized')
      filter.gmLoginId = loginId
    } else {
      if (!employeeId) throw createError(401, 'Unauthorized')
      filter.managerEmployeeId = employeeId
    }

    // optional search (by employeeId-like string OR name/department from directory)
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
          ],
        })
          .select('employeeId')
          .lean()

        const empIdsFromDir = dirs.map((d) => s(d.employeeId)).filter(Boolean)
        filter.employeeId = { $in: empIdsFromDir.length ? empIdsFromDir : ['__NO_MATCH__'] }
      }
    }

    const profiles = await LeaveProfile.find(filter).sort({ employeeId: 1 }).lean()

    // attach directory info in batch
    const ids = profiles.map((p) => s(p.employeeId)).filter(Boolean)
    const dirs = ids.length
      ? await EmployeeDirectory.find({ employeeId: { $in: ids } }).lean()
      : []
    const dirMap = new Map(dirs.map((d) => [s(d.employeeId), d]))

    const rows = profiles.map((p) => {
      const d = dirMap.get(s(p.employeeId))
      return {
        employeeId: s(p.employeeId),
        loginId: s(p.loginId),
        isActive: p.isActive !== false,
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        balances: Array.isArray(p.balances) ? p.balances : [],
        contracts: Array.isArray(p.contracts) ? p.contracts : [],
        employee: d
          ? {
              employeeId: s(d.employeeId),
              name: pickEmpName(d),
              department: s(d.department || d.dept),
              position: s(d.position || d.title),
              managerEmployeeId: s(d.managerEmployeeId),
              managerName: s(d.managerName),
            }
          : null,
      }
    })

    res.json({
      meta: { scope: isGm ? 'GM' : 'MANAGER', actor: isGm ? loginId : employeeId },
      rows,
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/leave/user/team/profiles/:employeeId
// returns one profile (must be under manager/gm scope)
exports.getTeamEmployeeProfile = async (req, res, next) => {
  try {
    const loginId = actorLoginId(req)
    const employeeId = actorEmployeeId(req)

    const isManager = hasAnyRole(req, ['MANAGER', 'LEAVE_MANAGER', 'DEPT_MANAGER'])
    const isGm = hasAnyRole(req, ['GM', 'LEAVE_GM'])

    if (!isManager && !isGm) throw createError(403, 'Not allowed')

    const targetId = s(req.params.employeeId)
    if (!targetId) throw createError(400, 'employeeId is required')

    const scopeFilter = isGm
      ? { gmLoginId: loginId }
      : { managerEmployeeId: employeeId }

    const profile = await LeaveProfile.findOne({ employeeId: targetId, ...scopeFilter }).lean()
    if (!profile) throw createError(404, 'Leave profile not found (or not in your team)')

    const dir = await findDirectoryByEmployeeId(targetId)

    res.json({
      profile,
      employee: dir
        ? {
            employeeId: s(dir.employeeId),
            name: pickEmpName(dir),
            department: s(dir.department || dir.dept),
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
