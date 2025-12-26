/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const { computeBalances } = require('../../utils/leave.rules')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase()))]
}

function actorLoginId(req) {
  // ✅ support old + new JWT payload shapes
  return String(req.user?.loginId || req.user?.id || req.user?.sub || '').trim()
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

async function getApprovedRequests(employeeId) {
  return LeaveRequest.find({ employeeId, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()
}

/**
 * ✅ 핵심: multi-role user MUST be able to view own profile.
 * - If asking for self: always allowed.
 * - If asking for others (?employeeId=): apply manager/gm/coo/admin restrictions.
 */
function canViewProfile({ roles, me, profile, targetEmployeeId }) {
  // ✅ always allow self
  if (String(targetEmployeeId) === String(me)) return true

  // admin can view anything
  if (roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')) return true

  // manager / gm / coo restrictions for "other employee"
  if (roles.includes('LEAVE_MANAGER')) {
    return String(profile.managerLoginId || '') === String(me)
  }
  if (roles.includes('LEAVE_GM')) {
    return String(profile.gmLoginId || '') === String(me)
  }
  if (roles.includes('LEAVE_COO')) {
    return String(profile.cooLoginId || '') === String(me)
  }

  // normal leave user cannot view others
  if (roles.includes('LEAVE_USER')) return false

  return false
}

/**
 * GET /api/leave/profile/my
 * - If no ?employeeId= -> returns my profile (always allowed)
 * - If ?employeeId=XXXX -> only allowed based on role ownership rules
 * - Returns balances computed from APPROVED requests (no DB write here)
 */
exports.getMyProfile = async (req, res) => {
  try {
    const roles = getRoles(req)
    const me = actorLoginId(req)
    if (!me) return res.status(401).json({ message: 'Unauthorized' })

    const targetEmployeeId = String(req.query.employeeId || '').trim()
    const employeeId = targetEmployeeId || me

    const doc = await LeaveProfile.findOne({ employeeId }).lean()
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    if (!canViewProfile({ roles, me, profile: doc, targetEmployeeId: employeeId })) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const approved = await getApprovedRequests(employeeId)
    const asOf = nowYMD()
    const snap = computeBalances(doc, approved, new Date(asOf + 'T00:00:00Z'))

    return res.json({
      ...doc,
      balances: Array.isArray(snap?.balances)
        ? snap.balances
        : (Array.isArray(doc.balances) ? doc.balances : []),
      balancesAsOf: asOf,
      meta: snap?.meta || null,
    })
  } catch (e) {
    console.error('getMyProfile error', e)
    return res.status(500).json({ message: 'Failed to load profile.' })
  }
}

/**
 * GET /api/leave/profile/managed
 * - MANAGER: employees where managerLoginId = me
 * - GM: employees where gmLoginId = me
 * - COO: employees where cooLoginId = me
 * - ADMIN/LEAVE_ADMIN: all active
 */
exports.listManagedProfiles = async (req, res) => {
  try {
    const roles = getRoles(req)
    const me = actorLoginId(req)
    if (!me) return res.status(401).json({ message: 'Unauthorized' })

    const query = { isActive: { $ne: false } }

    if (roles.includes('ADMIN') || roles.includes('LEAVE_ADMIN')) {
      // all active
    } else if (roles.includes('LEAVE_GM')) {
      query.gmLoginId = me
    } else if (roles.includes('LEAVE_COO')) {
      query.cooLoginId = me
    } else if (roles.includes('LEAVE_MANAGER')) {
      query.managerLoginId = me
    } else {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const rows = await LeaveProfile.find(query)
      .select('employeeId name department joinDate contractDate contractEndDate managerLoginId gmLoginId cooLoginId approvalMode isActive')
      .sort({ employeeId: 1 })
      .lean()

    return res.json(rows || [])
  } catch (e) {
    console.error('listManagedProfiles error', e)
    return res.status(500).json({ message: 'Failed to load employees.' })
  }
}
