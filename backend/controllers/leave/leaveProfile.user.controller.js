/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js
//
// ✅ getMyLeaveProfile
// - resolves employeeId safely (token -> EmployeeDirectory -> User)
// - returns profile + EmployeeDirectory fields (name/department/position/contact/telegramChatId)
// - keeps original profile shape (balances etc.) and just adds identity fields

const createError = require('http-errors')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User') // ✅ keep if you have it; if not, remove and also remove section (4)

const s = (v) => String(v ?? '').trim()

function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => String(x || '').toUpperCase().trim()))].filter(Boolean)
}
function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  // supports old/new JWT payload shapes
  return s(req.user?.loginId || req.user?.username || req.user?.userId || req.user?.id || '')
}
function actorEmployeeId(req) {
  return s(req.user?.employeeId || req.user?.empId || req.user?.employee?.employeeId || '')
}

function isDigits(v) {
  return /^\d+$/.test(String(v || '').trim())
}

/**
 * ✅ Resolve employeeId for LEAVE_USER safely
 * Tries multiple mappings because different DB schemas exist.
 */
async function resolveEmployeeId(req) {
  // 1) if token already has employeeId
  const empFromToken = actorEmployeeId(req)
  if (empFromToken) return empFromToken

  const loginId = actorLoginId(req)
  if (!loginId) return ''

  // 2) numeric loginId often equals employeeId (try EmployeeDirectory.employeeId)
  if (isDigits(loginId)) {
    const byEmpId = await EmployeeDirectory.findOne({ employeeId: String(loginId) })
      .select('employeeId')
      .lean()
    if (byEmpId?.employeeId) return s(byEmpId.employeeId)
  }

  // 3) EmployeeDirectory.loginId or EmployeeDirectory.userLoginId (string/number)
  const loginAsNumber = isDigits(loginId) ? Number(loginId) : null
  const byLoginId = await EmployeeDirectory.findOne({
    $or: [
      { loginId: String(loginId) },
      ...(loginAsNumber !== null ? [{ loginId: loginAsNumber }] : []),
      { userLoginId: String(loginId) },
      ...(loginAsNumber !== null ? [{ userLoginId: loginAsNumber }] : []),
    ],
  })
    .select('employeeId')
    .lean()

  if (byLoginId?.employeeId) return s(byLoginId.employeeId)

  // 4) User collection mapping (if your auth system stores employeeId there)
  // If you don't have User model/collection, remove this whole block.
  const user = await User.findOne({
    $or: [
      { loginId: String(loginId) },
      ...(loginAsNumber !== null ? [{ loginId: loginAsNumber }] : []),
      { username: String(loginId) },
    ],
  })
    .select('employeeId')
    .lean()

  if (user?.employeeId) return s(user.employeeId)

  return ''
}

/**
 * ✅ Extract EmployeeDirectory fields for UI
 * Supports different schema names (position/title/jobTitle)
 */
function extractEmpInfo(empDoc) {
  const emp = empDoc || {}
  const position = s(emp.position || emp.jobTitle || emp.title || emp.roleName || '')
  return {
    name: s(emp.name || emp.fullName || emp.employeeName || ''),
    department: s(emp.department || emp.dept || ''),
    position,
    contactNumber: s(emp.contactNumber || emp.phone || emp.mobile || ''),
    telegramChatId: s(emp.telegramChatId || emp.telegram || ''),
    isActive: typeof emp.isActive === 'boolean' ? emp.isActive : true,
  }
}

exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    if (!roles.length) throw createError(403, 'Forbidden')

    const employeeId = await resolveEmployeeId(req)
    if (!employeeId) throw createError(403, 'Forbidden: cannot resolve employeeId')

    // ✅ profile
    const profile = await LeaveProfile.findOne({ employeeId }).lean()
    if (!profile) throw createError(404, 'Leave profile not found')

    // ✅ employee directory info (seeded data)
    const emp = await EmployeeDirectory.findOne({ employeeId }).lean()
    const info = extractEmpInfo(emp)

    // ✅ Return merged (profile first, then identity fields)
    // This ensures balances/contracts/etc remain intact.
    res.json({
      ...profile,
      employeeId,
      ...info,
    })
  } catch (err) {
    next(err)
  }
}
