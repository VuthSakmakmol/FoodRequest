/* eslint-disable no-console */
const createError = require('http-errors')

let LeaveProfile = null
try { LeaveProfile = require('../../models/leave/LeaveProfile') } catch { LeaveProfile = null }

let LeaveType = null
try { LeaveType = require('../../models/leave/LeaveType') } catch { LeaveType = null } // optional

let LeaveRequest = null
try { LeaveRequest = require('../../models/leave/LeaveRequest') } catch { LeaveRequest = null } // ✅ needed for usage

let User = null
try { User = require('../../models/User') } catch { User = null }

const { computeBalances } = require('../../utils/leave.rules') // ✅ your file

function assertModel(m, name) {
  if (!m) throw createError(500, `${name} model missing. Create it at models/...`)
}

function safeStr(v) {
  return String(v ?? '').trim()
}
function upper(v) {
  return safeStr(v).toUpperCase()
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}
function pickUserId(req) {
  return safeStr(req?.user?.loginId || req?.user?.employeeId || req?.user?.id || 'system')
}

function ensureSystemLeaveTypesFallback() {
  return [
    { code: 'AL', name: 'Annual Leave', order: 1, isSystem: true },
    { code: 'SP', name: 'Special Permission', order: 2, isSystem: true },
    { code: 'MC', name: 'Medical Certificate', order: 3, isSystem: true },
    { code: 'MA', name: 'Maternity', order: 4, isSystem: true },
    { code: 'UL', name: 'Unpaid Leave', order: 5, isSystem: true },
  ]
}

/**
 * ✅ Approved statuses (tolerant)
 * Adjust this list to match your LeaveRequest workflow names.
 */
const FINAL_APPROVED_STATUSES = [
  'APPROVED',
  'FINAL_APPROVED',
  'COO_APPROVED',
  'APPROVED_COO',
  'GM_APPROVED',
  'APPROVED_GM',
  'COMPLETED',
]

async function fetchApprovedRequests(employeeId) {
  assertModel(LeaveRequest, 'LeaveRequest')

  // tolerant query: include common final approved statuses
  const rows = await LeaveRequest.find(
    {
      employeeId: safeStr(employeeId),
      status: { $in: FINAL_APPROVED_STATUSES },
    },
    { leaveTypeCode: 1, startDate: 1, endDate: 1, totalDays: 1, isHalfDay: 1, dayPart: 1, status: 1 }
  ).lean()

  // If your DB uses different status names, this can return empty.
  // That’s okay — balances still compute entitlement (AL/SP/MC/MA rules) even if used=0.
  return Array.isArray(rows) ? rows : []
}

async function recomputeAndPersistBalances(profileDoc, { now = new Date(), actor = 'system', reason = '' } = {}) {
  if (!profileDoc) throw createError(500, 'Missing profileDoc')

  // Compute using your rules + approved usage
  const approvedRequests = await fetchApprovedRequests(profileDoc.employeeId)
  const out = computeBalances(profileDoc, approvedRequests, now)

  const balances = Array.isArray(out?.balances) ? out.balances : []
  const meta = out?.meta || {}

  profileDoc.balances = balances.map((b) => ({
    leaveTypeCode: upper(b.leaveTypeCode),
    yearlyEntitlement: num(b.yearlyEntitlement),
    used: num(b.used),
    remaining: num(b.remaining),
  }))

  profileDoc.balancesAsOf = isValidYMD(meta?.contractYear?.startDate)
    ? safeStr(meta?.contractYear?.startDate)
    : safeStr(profileDoc?.contractDate || profileDoc?.joinDate || '')

  // Optional: store period for reporting
  profileDoc.contractYearStart = meta?.contractYear?.startDate || profileDoc.contractYearStart
  profileDoc.contractYearEnd = meta?.contractYear?.endDate || profileDoc.contractYearEnd

  // Optional: audit trail
  profileDoc.balanceLogs = Array.isArray(profileDoc.balanceLogs) ? profileDoc.balanceLogs : []
  profileDoc.balanceLogs.push({
    at: new Date(),
    by: actor,
    reason: safeStr(reason || 'RECALC'),
    contractYear: meta?.contractYear || null,
  })

  await profileDoc.save()
  return profileDoc
}

module.exports = {
  // ✅ GET /api/admin/leave/types
  async getLeaveTypes(req, res) {
    if (LeaveType) {
      const rows = await LeaveType.find(
        { isActive: { $ne: false } },
        { code: 1, name: 1, order: 1, isSystem: 1 }
      )
        .sort({ order: 1, code: 1 })
        .lean()

      return res.json(
        rows.map((r) => ({
          code: upper(r.code),
          name: safeStr(r.name) || upper(r.code),
          order: num(r.order ?? 999),
          isSystem: !!r.isSystem,
        }))
      )
    }

    return res.json(ensureSystemLeaveTypesFallback())
  },

  // ✅ GET /api/admin/leave/approvers
  async getApprovers(req, res) {
    assertModel(User, 'User')

    const rows = await User.find(
      { isActive: true, roles: { $in: ['LEAVE_GM', 'LEAVE_COO'] } },
      { loginId: 1, name: 1, roles: 1 }
    ).lean()

    const out = (rows || []).map((u) => {
      const roles = Array.isArray(u.roles) ? u.roles : []
      let role = ''
      if (roles.includes('LEAVE_GM')) role = 'LEAVE_GM'
      else if (roles.includes('LEAVE_COO')) role = 'LEAVE_COO'
      return {
        loginId: safeStr(u.loginId),
        name: safeStr(u.name),
        role,
        roles,
      }
    })

    res.json(out)
  },

  // ✅ GET /api/admin/leave/profiles/grouped?q=&includeInactive=1
  async getProfilesGrouped(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const q = safeStr(req.query.q).toLowerCase()
    const includeInactive = String(req.query.includeInactive || '0') === '1'
    const filter = includeInactive ? {} : { isActive: { $ne: false } }

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { managerName: { $regex: q, $options: 'i' } },
        { department: { $regex: q, $options: 'i' } },
        { employeeId: { $regex: q, $options: 'i' } },
      ]
    }

    const rows = await LeaveProfile.find(filter)
      .sort({ managerName: 1, name: 1 })
      .lean()

    const groupsMap = new Map()
    for (const r of rows || []) {
      const key = safeStr(r.managerEmployeeId || r.managerLoginId || 'NO_MANAGER')
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          managerKey: key,
          manager: {
            employeeId: safeStr(r.managerEmployeeId || ''),
            loginId: safeStr(r.managerLoginId || ''),
            name: safeStr(r.managerName || ''),
            department: safeStr(r.managerDepartment || ''),
          },
          employees: [],
        })
      }
      groupsMap.get(key).employees.push(r)
    }

    res.json(Array.from(groupsMap.values()))
  },

  // ✅ GET /api/admin/leave/profiles/:employeeId
  async getProfileOne(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const employeeId = safeStr(req.params.employeeId)
    if (!employeeId) throw createError(400, 'employeeId is required')

    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) throw createError(404, 'Profile not found')

    // ✅ Auto recalc if balances missing/empty (fix old data)
    const needsRecalc = !Array.isArray(doc.balances) || doc.balances.length === 0
    if (needsRecalc && LeaveRequest) {
      await recomputeAndPersistBalances(doc, {
        actor: pickUserId(req),
        reason: 'AUTO_RECALC_EMPTY_BALANCES',
      })
    }

    res.json({ profile: doc.toObject ? doc.toObject() : doc })
  },

  // ✅ POST /api/admin/leave/profiles
  async createProfileSingle(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const body = req.body || {}
    const employeeId = safeStr(body.employeeId)
    if (!employeeId) throw createError(400, 'employeeId is required')

    const exists = await LeaveProfile.findOne({ employeeId }).lean()
    if (exists) throw createError(409, 'Profile already exists')

    const doc = await LeaveProfile.create({ ...body, employeeId })

    // ✅ compute balances immediately (so UI never shows zeros)
    if (LeaveRequest) {
      await recomputeAndPersistBalances(doc, {
        actor: pickUserId(req),
        reason: 'CREATE_PROFILE_INIT_BALANCES',
      })
    }

    res.status(201).json({ profile: doc })
  },

  // ✅ POST /api/admin/leave/managers  (and /profiles/manager-with-employees)
  async createManagerWithEmployees(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const body = req.body || {}
    const approvalMode = upper(body.approvalMode) || 'MANAGER_AND_GM'
    const managerEmployeeId = safeStr(body.managerEmployeeId)
    const managerLoginId = safeStr(body.managerLoginId)
    const gmLoginId = safeStr(body.gmLoginId)
    const cooLoginId = safeStr(body.cooLoginId)
    const employees = Array.isArray(body.employees) ? body.employees : []

    if (!gmLoginId) throw createError(400, 'gmLoginId is required')
    if (approvalMode === 'GM_AND_COO' && !cooLoginId) {
      throw createError(400, 'cooLoginId is required for GM_AND_COO mode')
    }
    if (!employees.length) throw createError(400, 'employees[] is required')

    const employeeIds = employees.map(e => safeStr(e?.employeeId)).filter(Boolean)
    const existing = employeeIds.length
      ? await LeaveProfile.find({ employeeId: { $in: employeeIds } }, { employeeId: 1 }).lean()
      : []
    const existSet = new Set((existing || []).map(x => safeStr(x.employeeId)))

    const created = []
    const skipped = []

    for (const e of employees) {
      const eid = safeStr(e?.employeeId)
      if (!eid) {
        skipped.push({ employeeId: eid, reason: 'missing employeeId' })
        continue
      }
      if (existSet.has(eid)) {
        skipped.push({ employeeId: eid, reason: 'already exists' })
        continue
      }

      const doc = await LeaveProfile.create({
        ...e,
        employeeId: eid,
        approvalMode,
        managerEmployeeId: managerEmployeeId || null,
        managerLoginId: managerLoginId || null,
        gmLoginId,
        cooLoginId: approvalMode === 'GM_AND_COO' ? (cooLoginId || null) : null,
        isActive: e?.isActive === false ? false : true,
      })

      if (LeaveRequest) {
        await recomputeAndPersistBalances(doc, {
          actor: pickUserId(req),
          reason: 'CREATE_MANAGER_BATCH_INIT_BALANCES',
        })
      }

      created.push(doc)
      existSet.add(eid)
    }

    res.status(201).json({ createdCount: created.length, skipped, created })
  },

  // ✅ PATCH /api/admin/leave/profiles/:employeeId?recalc=1
  async updateProfile(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const employeeId = safeStr(req.params.employeeId)
    if (!employeeId) throw createError(400, 'employeeId is required')

    const body = req.body || {}
    if (body.approvalMode) body.approvalMode = upper(body.approvalMode)

    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) throw createError(404, 'Profile not found')

    Object.keys(body).forEach((k) => {
      doc[k] = body[k]
    })

    await doc.save()

    // ✅ if caller asks recalc
    const wantRecalc = String(req.query.recalc || '0') === '1'
    if (wantRecalc && LeaveRequest) {
      await recomputeAndPersistBalances(doc, {
        actor: pickUserId(req),
        reason: 'UPDATE_PROFILE_RECALC',
      })
    }

    res.json({ profile: doc })
  },

  // ✅ POST /api/admin/leave/profiles/:employeeId/recalculate
  async recalculateProfile(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')
    if (!LeaveRequest) throw createError(500, 'LeaveRequest model missing (required for recalculation)')

    const employeeId = safeStr(req.params.employeeId)
    if (!employeeId) throw createError(400, 'employeeId is required')

    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) throw createError(404, 'Profile not found')

    const asOf = safeStr(req.body?.asOf)
    const reason = safeStr(req.body?.reason || 'MANUAL_RECALC')
    const now = isValidYMD(asOf) ? new Date(`${asOf}T00:00:00.000Z`) : new Date()

    await recomputeAndPersistBalances(doc, {
      now,
      actor: pickUserId(req),
      reason,
    })

    res.json({ ok: true, profile: doc })
  },

  // ✅ POST /api/admin/leave/profiles/:employeeId/contracts/renew
  async renewContract(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const employeeId = safeStr(req.params.employeeId)
    const newContractDate = safeStr(req.body?.newContractDate)
    const clearUnusedAL = !!req.body?.clearUnusedAL
    const note = safeStr(req.body?.note)

    if (!employeeId) throw createError(400, 'employeeId is required')
    if (!isValidYMD(newContractDate)) throw createError(400, 'newContractDate must be YYYY-MM-DD')

    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) throw createError(404, 'Profile not found')

    doc.contractHistory = Array.isArray(doc.contractHistory) ? doc.contractHistory : []
    doc.contractHistory.push({
      contractNo: doc.contractHistory.length + 1,
      startDate: safeStr(doc.contractDate || doc.joinDate || ''),
      endDate: null,
      newContractDate,
      clearUnusedAL,
      alCarrySnapshot: num(doc.alCarry ?? 0),
      balancesSnapshot: Array.isArray(doc.balances) ? doc.balances : [],
      note: note || null,
      createdBy: pickUserId(req),
      createdAt: new Date(),
    })

    doc.contractDate = newContractDate

    // Clear unused AL (positive only), keep negative debt
    if (clearUnusedAL && Array.isArray(doc.balances)) {
      const al = doc.balances.find(b => upper(b?.leaveTypeCode) === 'AL')
      if (al && num(al.remaining) > 0) al.remaining = 0
    }

    await doc.save()

    // ✅ recompute for new contract-year window
    if (LeaveRequest) {
      await recomputeAndPersistBalances(doc, {
        actor: pickUserId(req),
        reason: 'RENEW_CONTRACT_RECALC',
      })
    }

    res.json({ profile: doc })
  },

  // ✅ DELETE /api/admin/leave/profiles/:employeeId
  async deactivateProfile(req, res) {
    assertModel(LeaveProfile, 'LeaveProfile')

    const employeeId = safeStr(req.params.employeeId)
    if (!employeeId) throw createError(400, 'employeeId is required')

    const doc = await LeaveProfile.findOneAndUpdate(
      { employeeId },
      { $set: { isActive: false } },
      { new: true }
    )

    if (!doc) throw createError(404, 'Profile not found')
    res.json({ ok: true, profile: doc })
  },
}
