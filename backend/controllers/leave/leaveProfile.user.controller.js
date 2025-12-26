/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const { computeBalances } = require('../../utils/leave.rules')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'

// Phnom Penh is UTC+7 (no DST)
const PP_OFFSET_MINUTES = 7 * 60

/* ───────────────── helpers ───────────────── */

const uniqUpper = (arr) =>
  [...new Set((arr || []).map((x) => String(x || '').toUpperCase().trim()))].filter(Boolean)

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return uniqUpper([...raw, ...base])
}

function actorLoginId(req) {
  // ✅ supports old + new JWT payload shapes
  return String(req.user?.loginId || req.user?.id || req.user?.sub || '').trim()
}

function actorEmployeeId(req) {
  // ✅ best: use employeeId if present, otherwise fallback to loginId pattern
  return String(req.user?.employeeId || actorLoginId(req) || '').trim()
}

/**
 * Phnom Penh "today" as YYYY-MM-DD (no dayjs needed)
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

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

/**
 * Create a Date that represents Phnom Penh local midnight for the given YMD,
 * independent of the server timezone.
 *
 * Phnom Penh midnight (00:00 at UTC+7) equals 17:00 of previous day in UTC.
 */
function phnomPenhMidnightDate(ymd) {
  const s = String(ymd || '').trim()
  if (!isValidYMD(s)) return new Date()

  const [y, m, d] = s.split('-').map((x) => Number(x))
  const utcMidnight = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0)
  const ppMidnightUtc = utcMidnight - PP_OFFSET_MINUTES * 60 * 1000
  return new Date(ppMidnightUtc)
}

async function getApprovedRequests(employeeId) {
  const emp = String(employeeId || '').trim()
  if (!emp) return []
  return LeaveRequest.find({ employeeId: emp, status: 'APPROVED' })
    .sort({ startDate: 1 })
    .lean()
}

function isAdminLike(roles) {
  const set = new Set(roles || [])
  return set.has('ADMIN') || set.has('ROOT_ADMIN') || set.has('LEAVE_ADMIN')
}

/**
 * ✅ 핵심: multi-role user MUST be able to view own profile.
 * - If asking for self: always allowed.
 * - If asking for others (?employeeId=): apply manager/gm/coo/admin restrictions.
 *
 * IMPORTANT:
 * Some deployments store approver fields (managerLoginId/gmLoginId/cooLoginId)
 * as loginId. Some store as employeeId. We allow both by checking (meLoginId OR meEmployeeId).
 */
function canViewProfile({ roles, meLoginId, meEmployeeId, profile, targetEmployeeId }) {
  const meA = String(meLoginId || '').trim()
  const meB = String(meEmployeeId || '').trim()
  const target = String(targetEmployeeId || '').trim()

  // ✅ always allow self
  if (target && (target === meA || target === meB)) return true

  // ✅ admins can view anything
  if (isAdminLike(roles)) return true

  const mgr = String(profile?.managerLoginId || '').trim()
  const gm = String(profile?.gmLoginId || '').trim()
  const coo = String(profile?.cooLoginId || '').trim()

  const isMe = (v) => v && (v === meA || v === meB)

  if (roles.includes('LEAVE_MANAGER')) return isMe(mgr)
  if (roles.includes('LEAVE_GM')) return isMe(gm)
  if (roles.includes('LEAVE_COO')) return isMe(coo)

  // leave users cannot view others
  if (roles.includes('LEAVE_USER')) return false

  return false
}

/* ───────────────── controllers ───────────────── */

/**
 * GET /api/leave/profile/my
 * - If no ?employeeId= -> returns my profile (always allowed)
 * - If ?employeeId=XXXX -> only allowed based on role ownership rules
 * - Returns balances computed from APPROVED requests (no DB write here)
 *
 * ✅ Real-time behavior:
 * This endpoint stays read-only. Frontend refreshes it when it receives socket events
 * (leave:req:*). Your leaveRequest.controller emits those events via broadcastLeaveRequest.
 */
exports.getMyProfile = async (req, res) => {
  try {
    const roles = getRoles(req)
    const meLoginId = actorLoginId(req)
    const meEmployeeId = actorEmployeeId(req)

    if (!meLoginId) return res.status(401).json({ message: 'Unauthorized' })

    const targetEmployeeId = String(req.query.employeeId || '').trim()
    const employeeId = targetEmployeeId || meEmployeeId || meLoginId

    const doc = await LeaveProfile.findOne({ employeeId }).lean()
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    const ok = canViewProfile({
      roles,
      meLoginId,
      meEmployeeId,
      profile: doc,
      targetEmployeeId: employeeId,
    })
    if (!ok) return res.status(403).json({ message: 'Forbidden' })

    const approved = await getApprovedRequests(employeeId)

    const asOf = nowYMD()
    const asOfDate = phnomPenhMidnightDate(asOf)

    const snap = computeBalances(doc, approved, asOfDate)

    return res.json({
      ...doc,
      balances: Array.isArray(snap?.balances)
        ? snap.balances
        : Array.isArray(doc.balances)
          ? doc.balances
          : [],
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
 * - MANAGER: employees where managerLoginId = me (or my employeeId)
 * - GM: employees where gmLoginId = me (or my employeeId)
 * - COO: employees where cooLoginId = me (or my employeeId)
 * - ADMIN/LEAVE_ADMIN: all active
 *
 * ✅ Real-time behavior:
 * This is read-only. Frontend can refresh list when receiving leave:profile:* events
 * (emitted from admin controller via broadcastLeaveProfile).
 */
exports.listManagedProfiles = async (req, res) => {
  try {
    const roles = getRoles(req)
    const meLoginId = actorLoginId(req)
    const meEmployeeId = actorEmployeeId(req)

    if (!meLoginId) return res.status(401).json({ message: 'Unauthorized' })

    const query = { isActive: { $ne: false } }

    if (isAdminLike(roles)) {
      // all active
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
      .select(
        'employeeId name department joinDate contractDate contractEndDate managerLoginId gmLoginId cooLoginId approvalMode isActive'
      )
      .sort({ employeeId: 1 })
      .lean()

    return res.json(rows || [])
  } catch (e) {
    console.error('listManagedProfiles error', e)
    return res.status(500).json({ message: 'Failed to load employees.' })
  }
}
