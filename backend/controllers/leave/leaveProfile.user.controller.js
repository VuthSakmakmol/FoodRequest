/* eslint-disable no-console */
// backend/controllers/leave/leaveProfile.user.controller.js

const createError = require('http-errors')
const dayjs = require('dayjs')

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
  const direct = s(req.user?.employeeId)
  if (direct) return direct

  const idLike = actorLoginId(req)
  // many of your tokens use numeric loginId = employeeId
  if (/^\d{4,}$/.test(idLike)) return idLike

  return ''
}

function pickApprovalModeSemantic(profile) {
  const raw =
    s(profile?.approvalMode) ||
    s(profile?.meta?.approvalMode) ||
    s(profile?.approval?.mode) ||
    ''
  const up = raw.toUpperCase()

  const hasCoo = !!s(profile?.cooLoginId || profile?.meta?.cooLoginId || profile?.approval?.cooLoginId)
  if (up.includes('COO') || up.includes('GM_AND_COO') || up.includes('GM+COO') || up.includes('GM_COO') || hasCoo)
    return 'GM_AND_COO'

  // everything else = GM only (no COO)
  return 'GM_ONLY'
}

async function loadProfileByEmployeeId(employeeId) {
  const empId = s(employeeId)
  if (!empId) return null
  return LeaveProfile.findOne({ employeeId: empId }).lean()
}

function canViewSelfOnly(roles) {
  // user only
  return roles.includes('LEAVE_USER') && !roles.some((r) => ['LEAVE_MANAGER', 'LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN'].includes(r))
}

/**
 * ✅ Core authorization:
 * - self: always ok (if employeeId matches actor)
 * - manager: only if profile.managerLoginId matches actorLoginId
 * - gm: only if gmLoginId matches AND approvalMode == GM_ONLY
 * - coo: only if cooLoginId matches AND approvalMode == GM_AND_COO
 * - admin: allow
 */
function assertCanViewEmployee({ roles, actorLogin, actorEmpId, targetEmpId, profile }) {
  const isAdmin = roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN')
  if (isAdmin) return true

  if (s(targetEmpId) && s(actorEmpId) && s(targetEmpId) === s(actorEmpId)) return true

  const mgrOk =
    roles.includes('LEAVE_MANAGER') && s(profile?.managerLoginId) && s(profile.managerLoginId) === s(actorLogin)

  if (mgrOk) return true

  const mode = pickApprovalModeSemantic(profile)

  const gmOk =
    roles.includes('LEAVE_GM') &&
    mode === 'GM_ONLY' &&
    s(profile?.gmLoginId) &&
    s(profile.gmLoginId) === s(actorLogin)

  if (gmOk) return true

  const cooOk =
    roles.includes('LEAVE_COO') &&
    mode === 'GM_AND_COO' &&
    s(profile?.cooLoginId) &&
    s(profile.cooLoginId) === s(actorLogin)

  if (cooOk) return true

  throw createError(403, 'Not allowed to view this employee.')
}

/* ───────────────── controllers ───────────────── */

/**
 * ✅ GET /api/leave/user/profile?employeeId=xxxx&contractId=...
 * - LEAVE_USER: if no employeeId -> self; if employeeId != self -> 403
 * - MANAGER/GM/COO: can pass employeeId but must be authorized
 */
exports.getMyLeaveProfile = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    const actorLogin = actorLoginId(req)
    const actorEmpId = actorEmployeeId(req)

    const requestedEmpId = s(req.query?.employeeId) || actorEmpId
    if (!requestedEmpId) throw createError(400, 'Missing employeeId.')

    const profile = await loadProfileByEmployeeId(requestedEmpId)
    if (!profile) throw createError(404, 'Leave profile not found.')

    // enforce visibility rules
    assertCanViewEmployee({
      roles,
      actorLogin,
      actorEmpId,
      targetEmpId: requestedEmpId,
      profile,
    })

    // optional: attach directory info (if you want)
    let directory = null
    try {
      directory = await EmployeeDirectory.findOne({ employeeId: requestedEmpId }).lean()
    } catch {}

    res.json({
      profile,
      directory: directory
        ? {
            employeeId: s(directory.employeeId),
            name: s(directory.name),
            department: s(directory.department),
            section: s(directory.section),
            managerLoginId: s(directory.managerLoginId),
            gmLoginId: s(directory.gmLoginId),
          }
        : null,
      meta: {
        approvalMode: pickApprovalModeSemantic(profile),
        now: dayjs().format('YYYY-MM-DD'),
      },
    })
  } catch (e) {
    next(e)
  }
}

/**
 * ✅ GET /api/leave/user/profile/managed
 * Manager staff list: ONLY profiles where managerLoginId == my loginId
 */
exports.getManagedProfiles = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    const actorLogin = actorLoginId(req)
    if (!roles.includes('LEAVE_MANAGER') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      throw createError(403, 'Manager access required.')
    }

    const q = s(req.query?.q)
    const includeInactive = s(req.query?.includeInactive) === '1'
    const limit = Math.min(Number(req.query?.limit || 500), 2000)

    const filter = {
      managerLoginId: actorLogin,
      ...(includeInactive ? {} : { isActive: { $ne: false } }),
    }

    if (q) {
      filter.$or = [
        { employeeId: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { department: { $regex: q, $options: 'i' } },
      ]
    }

    const rows = await LeaveProfile.find(filter).limit(limit).lean()

    res.json({
      employees: rows.map((p) => ({
        employeeId: s(p.employeeId),
        name: s(p.name),
        department: s(p.department),
        section: s(p.section),
        joinDate: p.joinDate || p.meta?.joinDate || null,
        contractDate: p.contractDate || p.meta?.contractDate || null,
        contractEndDate: p.contractEndDate || p.meta?.contractEndDate || null,
        managerLoginId: s(p.managerLoginId),
        gmLoginId: s(p.gmLoginId),
        cooLoginId: s(p.cooLoginId),
        approvalMode: pickApprovalModeSemantic(p),
        isActive: p.isActive !== false,
      })),
      meta: { scope: 'MANAGER', managerLoginId: actorLogin },
    })
  } catch (e) {
    next(e)
  }
}

/**
 * ✅ GET /api/leave/user/profile/gm-managed
 * GM staff list: ONLY profiles where gmLoginId == my loginId AND mode == GM_ONLY
 */
exports.getGmManagedProfiles = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    const actorLogin = actorLoginId(req)
    if (!roles.includes('LEAVE_GM') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      throw createError(403, 'GM access required.')
    }

    const q = s(req.query?.q)
    const includeInactive = s(req.query?.includeInactive) === '1'
    const limit = Math.min(Number(req.query?.limit || 500), 2000)

    const filter = {
      gmLoginId: actorLogin,
      ...(includeInactive ? {} : { isActive: { $ne: false } }),
    }

    if (q) {
      filter.$or = [
        { employeeId: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { department: { $regex: q, $options: 'i' } },
      ]
    }

    const rows = await LeaveProfile.find(filter).limit(limit).lean()
    const gmOnly = rows.filter((p) => pickApprovalModeSemantic(p) === 'GM_ONLY')

    res.json({
      employees: gmOnly.map((p) => ({
        employeeId: s(p.employeeId),
        name: s(p.name),
        department: s(p.department),
        section: s(p.section),
        joinDate: p.joinDate || p.meta?.joinDate || null,
        contractDate: p.contractDate || p.meta?.contractDate || null,
        contractEndDate: p.contractEndDate || p.meta?.contractEndDate || null,
        managerLoginId: s(p.managerLoginId),
        gmLoginId: s(p.gmLoginId),
        cooLoginId: s(p.cooLoginId),
        approvalMode: 'GM_ONLY',
        isActive: p.isActive !== false,
      })),
      meta: { scope: 'GM', gmLoginId: actorLogin, approvalMode: 'GM_ONLY' },
    })
  } catch (e) {
    next(e)
  }
}

/**
 * ✅ GET /api/leave/user/profile/coo-managed
 * COO staff list: ONLY profiles where cooLoginId == my loginId AND mode == GM_AND_COO
 */
exports.getCooManagedProfiles = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    const actorLogin = actorLoginId(req)
    if (!roles.includes('LEAVE_COO') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      throw createError(403, 'COO access required.')
    }

    const q = s(req.query?.q)
    const includeInactive = s(req.query?.includeInactive) === '1'
    const limit = Math.min(Number(req.query?.limit || 500), 2000)

    const filter = {
      cooLoginId: actorLogin,
      ...(includeInactive ? {} : { isActive: { $ne: false } }),
    }

    if (q) {
      filter.$or = [
        { employeeId: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { department: { $regex: q, $options: 'i' } },
      ]
    }

    const rows = await LeaveProfile.find(filter).limit(limit).lean()
    const gmAndCoo = rows.filter((p) => pickApprovalModeSemantic(p) === 'GM_AND_COO')

    res.json({
      employees: gmAndCoo.map((p) => ({
        employeeId: s(p.employeeId),
        name: s(p.name),
        department: s(p.department),
        section: s(p.section),
        joinDate: p.joinDate || p.meta?.joinDate || null,
        contractDate: p.contractDate || p.meta?.contractDate || null,
        contractEndDate: p.contractEndDate || p.meta?.contractEndDate || null,
        managerLoginId: s(p.managerLoginId),
        gmLoginId: s(p.gmLoginId),
        cooLoginId: s(p.cooLoginId),
        approvalMode: 'GM_AND_COO',
        isActive: p.isActive !== false,
      })),
      meta: { scope: 'COO', cooLoginId: actorLogin, approvalMode: 'GM_AND_COO' },
    })
  } catch (e) {
    next(e)
  }
}
