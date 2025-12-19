// backend/controllers/leave/leaveProfiles.admin.controller.js
/* eslint-disable no-console */
const bcrypt = require('bcryptjs')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const DEFAULT_PWD_POLICY = process.env.LEAVE_DEFAULT_PASSWORD || '123456' // change if you want

// ---------- helpers ----------
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

function assertYMD(s, label = 'date') {
  const v = String(s || '').trim()
  if (!isValidYMD(v)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD, got "${s}"`)
  return v
}

function nowYMD(tz = DEFAULT_TZ) {
  // timezone-safe YYYY-MM-DD without dayjs plugins
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

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

function fullMonthsBetween(joinYmd, asOfYmd) {
  const join = ymdToUTCDate(assertYMD(joinYmd, 'joinDate'))
  const asOf = ymdToUTCDate(assertYMD(asOfYmd, 'asOfDate'))

  let months =
    (asOf.getUTCFullYear() - join.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - join.getUTCMonth())

  if (asOf.getUTCDate() < join.getUTCDate()) months -= 1
  return Math.max(0, months)
}

function fullYearsBetween(joinYmd, asOfYmd) {
  const join = ymdToUTCDate(assertYMD(joinYmd, 'joinDate'))
  const asOf = ymdToUTCDate(assertYMD(asOfYmd, 'asOfDate'))

  let years = asOf.getUTCFullYear() - join.getUTCFullYear()

  const annivThisYear = new Date(Date.UTC(asOf.getUTCFullYear(), join.getUTCMonth(), join.getUTCDate()))
  if (asOf.getTime() < annivThisYear.getTime()) years -= 1

  return Math.max(0, years)
}

// AL yearly cap: base 18, +1 day per 3 years service (3y=19, 6y=20, ...)
function alYearlyCap(joinYmd, asOfYmd) {
  const years = fullYearsBetween(joinYmd, asOfYmd)
  return 18 + Math.floor(years / 3)
}

/**
 * Recalculate balances and SAVE them in profile.balances for backup.
 * - preserves existing "used" numbers from DB
 * - recomputes remaining from joinDate/contractDate rules
 */
function recalcBalances(profile, asOfYmd) {
  const asOf = assertYMD(asOfYmd, 'asOfDate')
  const joinDate = assertYMD(profile.joinDate, 'joinDate')

  // contract start baseline (AL resets each contract)
  let contractStart = profile.contractDate ? String(profile.contractDate) : joinDate
  if (!isValidYMD(contractStart)) contractStart = joinDate
  // clamp: contractStart cannot be before joinDate for our math
  const joinDt = ymdToUTCDate(joinDate)
  const cDt = ymdToUTCDate(contractStart)
  if (cDt.getTime() < joinDt.getTime()) contractStart = joinDate

  const usedMap = new Map()
  for (const b of profile.balances || []) {
    const code = String(b.leaveTypeCode || '').toUpperCase()
    if (!code) continue
    usedMap.set(code, num(b.used))
  }

  const AL_USED = usedMap.get('AL') || 0
  const SP_USED = usedMap.get('SP') || 0
  const MC_USED = usedMap.get('MC') || 0
  const MA_USED = usedMap.get('MA') || 0
  const UL_USED = usedMap.get('UL') || 0

  const capAL = alYearlyCap(joinDate, asOf)

  const monthsNow = fullMonthsBetween(joinDate, asOf)
  const monthsAtContractStart = fullMonthsBetween(joinDate, contractStart)
  const deltaMonths = Math.max(0, monthsNow - monthsAtContractStart)

  // AL accrual within current contract window
  const accruedAL = Math.min(capAL, deltaMonths * 1.5)

  // carry (debt allowed)
  const carry = num(profile.alCarry)

  // Remaining AL = accrued + carry - used (can go negative)
  const remainingAL = num(accruedAL + carry - AL_USED)

  const remainingSP = Math.max(0, 7 - SP_USED)
  const remainingMC = Math.max(0, 90 - MC_USED)
  const remainingMA = Math.max(0, 90 - MA_USED)

  return [
    { leaveTypeCode: 'AL', yearlyEntitlement: capAL, used: num(AL_USED), remaining: remainingAL },
    { leaveTypeCode: 'SP', yearlyEntitlement: 7, used: num(SP_USED), remaining: remainingSP },
    { leaveTypeCode: 'MC', yearlyEntitlement: 90, used: num(MC_USED), remaining: remainingMC },
    { leaveTypeCode: 'MA', yearlyEntitlement: 90, used: num(MA_USED), remaining: remainingMA },
    { leaveTypeCode: 'UL', yearlyEntitlement: 0, used: num(UL_USED), remaining: 0 },
  ]
}

async function ensureUser({ loginId, name, role, isActive = true }) {
  const id = String(loginId || '').trim()
  if (!id) return null

  const existing = await User.findOne({ loginId: id })
  if (existing) {
    const updates = {}
    if (name && existing.name !== name) updates.name = name
    if (role && existing.role !== role) updates.role = role
    if (typeof isActive === 'boolean' && existing.isActive !== isActive) updates.isActive = isActive
    if (Object.keys(updates).length) {
      await User.updateOne({ _id: existing._id }, { $set: updates })
    }
    return existing
  }

  const plainPwd = DEFAULT_PWD_POLICY === 'EMPLOYEE_ID' ? id : DEFAULT_PWD_POLICY
  const passwordHash = await bcrypt.hash(String(plainPwd), 10)

  const created = await User.create({
    loginId: id,
    name: name || id,
    role,
    passwordHash,
    isActive: !!isActive,
  })
  return created
}

async function getDirectory(empId) {
  const eid = String(empId || '').trim()
  if (!eid) return null
  return EmployeeDirectory.findOne({ employeeId: eid }).lean()
}

// ---------- auth helpers (match your existing pattern) ----------
function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase()))]
}
function requireAnyRole(...allowed) {
  const allow = allowed.map(x => String(x).toUpperCase())
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    const roles = getRoles(req)
    const ok = roles.some(r => allow.includes(r))
    if (!ok) return res.status(403).json({ message: 'Forbidden' })
    next()
  }
}

// ---------- controllers ----------
async function getApprovers(req, res) {
  try {
    // return GM list (and keep future-proof)
    const docs = await User.find({ role: { $in: ['LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'] }, isActive: true })
      .select('loginId name role')
      .lean()

    // frontend filters LEAVE_GM, but we return all
    res.json(
      (docs || []).map(d => ({
        loginId: String(d.loginId || ''),
        name: d.name || '',
        role: d.role || '',
      }))
    )
  } catch (e) {
    console.error('getApprovers error', e)
    res.status(500).json({ message: 'Failed to load approvers.' })
  }
}

async function getProfilesGrouped(req, res) {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1'

    const query = includeInactive ? {} : { isActive: { $ne: false } }
    const profiles = await LeaveProfile.find(query).lean()

    // sync + persist balances for backup (only for active profiles)
    const asOf = nowYMD()

    // We need fresh docs for saving. We'll do a second pass for active ones only.
    const activeIds = (profiles || []).filter(p => p?.isActive !== false).map(p => String(p.employeeId))
    if (activeIds.length) {
      const docsToSave = await LeaveProfile.find({ employeeId: { $in: activeIds } })
      for (const doc of docsToSave) {
        if (!doc.joinDate || !isValidYMD(doc.joinDate)) continue
        const newBalances = recalcBalances(doc, asOf)
        doc.balances = newBalances
        doc.balancesAsOf = asOf
        await doc.save()
      }
    }

    // reload lean after saving so response contains updated balances
    const fresh = await LeaveProfile.find(query).lean()

    const byMgr = new Map()
    for (const p of fresh || []) {
      const mgrId = String(p.managerLoginId || '').trim() || '—'
      if (!byMgr.has(mgrId)) byMgr.set(mgrId, [])
      byMgr.get(mgrId).push(p)
    }

    const managerIds = Array.from(byMgr.keys()).filter(x => x && x !== '—')
    const mgrDirs = await EmployeeDirectory.find({ employeeId: { $in: managerIds } }).lean()
    const mgrMap = new Map((mgrDirs || []).map(d => [String(d.employeeId), d]))

    const out = []
    for (const [managerLoginId, emps] of byMgr.entries()) {
      const md = mgrMap.get(String(managerLoginId)) || null

      // employees sorted
      const employees = (emps || []).slice().sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)))

      out.push({
        manager: {
          employeeId: managerLoginId,
          name: md?.name || '',
          department: md?.department || '',
        },
        employees: employees.map(x => ({
          employeeId: x.employeeId,
          name: x.name || '',
          department: x.department || '',
          joinDate: x.joinDate || null,
          contractDate: x.contractDate || null,
          managerLoginId: x.managerLoginId || '',
          gmLoginId: x.gmLoginId || '',
          alCarry: num(x.alCarry),
          isActive: x.isActive !== false,
          balances: Array.isArray(x.balances) ? x.balances : [],
        })),
      })
    }

    // sort manager blocks by manager id
    out.sort((a, b) => String(a.manager.employeeId).localeCompare(String(b.manager.employeeId)))

    res.json(out)
  } catch (e) {
    console.error('getProfilesGrouped error', e)
    res.status(500).json({ message: 'Failed to load grouped profiles.' })
  }
}

async function getProfileOne(req, res) {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    const asOf = nowYMD()
    if (doc.joinDate && isValidYMD(doc.joinDate)) {
      doc.balances = recalcBalances(doc, asOf)
      doc.balancesAsOf = asOf
      await doc.save()
    }

    res.json({ profile: doc })
  } catch (e) {
    console.error('getProfileOne error', e)
    res.status(500).json({ message: 'Failed to load profile.' })
  }
}

async function createProfileSingle(req, res) {
  try {
    const employeeId = String(req.body.employeeId || '').trim()
    const managerLoginId = String(req.body.managerLoginId || '').trim()
    const gmLoginId = String(req.body.gmLoginId || '').trim()

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })
    if (!managerLoginId) return res.status(400).json({ message: 'managerLoginId is required.' })
    if (!gmLoginId) return res.status(400).json({ message: 'gmLoginId is required.' })

    const joinDate = req.body.joinDate ? assertYMD(req.body.joinDate, 'joinDate') : ''
    const contractDate = req.body.contractDate ? assertYMD(req.body.contractDate, 'contractDate') : ''
    const alCarry = num(req.body.alCarry)
    const isActive = req.body.isActive !== false

    const empDir = await getDirectory(employeeId)
    const mgrDir = await getDirectory(managerLoginId)

    // create user accounts
    await ensureUser({ loginId: employeeId, name: empDir?.name || req.body.name || employeeId, role: 'LEAVE_USER', isActive })
    await ensureUser({ loginId: managerLoginId, name: mgrDir?.name || managerLoginId, role: 'LEAVE_MANAGER', isActive: true })

    // Upsert profile (reactivate if existed)
    let prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) {
      prof = new LeaveProfile({
        employeeId,
        employeeLoginId: employeeId,
      })
    }

    prof.managerLoginId = managerLoginId
    prof.gmLoginId = gmLoginId
    prof.joinDate = joinDate || prof.joinDate || ''
    prof.contractDate = contractDate || prof.contractDate || ''
    prof.alCarry = alCarry
    prof.isActive = isActive

    prof.name = empDir?.name || prof.name || ''
    prof.department = empDir?.department || prof.department || ''

    // Persist balances immediately
    if (prof.joinDate && isValidYMD(prof.joinDate)) {
      const asOf = nowYMD()
      prof.balances = recalcBalances(prof, asOf)
      prof.balancesAsOf = asOf
    }

    await prof.save()
    res.json({ ok: true, profile: prof })
  } catch (e) {
    console.error('createProfileSingle error', e)
    res.status(400).json({ message: e.message || 'Failed to create profile.' })
  }
}

async function createManagerWithEmployees(req, res) {
  try {
    const managerEmployeeId = String(req.body.managerEmployeeId || '').trim()
    const gmLoginId = String(req.body.gmLoginId || '').trim()
    const employees = Array.isArray(req.body.employees) ? req.body.employees : []

    if (!managerEmployeeId) return res.status(400).json({ message: 'managerEmployeeId is required.' })
    if (!gmLoginId) return res.status(400).json({ message: 'gmLoginId is required.' })
    if (!employees.length) return res.status(400).json({ message: 'employees[] is required.' })

    const mgrDir = await getDirectory(managerEmployeeId)
    await ensureUser({ loginId: managerEmployeeId, name: mgrDir?.name || managerEmployeeId, role: 'LEAVE_MANAGER', isActive: true })

    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0

    for (const row of employees) {
      const employeeId = String(row?.employeeId || '').trim()
      if (!employeeId) {
        skippedCount += 1
        continue
      }

      const joinDate = row.joinDate ? assertYMD(row.joinDate, 'joinDate') : ''
      const contractDate = row.contractDate ? assertYMD(row.contractDate, 'contractDate') : ''
      const alCarry = num(row.alCarry)
      const isActive = row.isActive !== false

      const empDir = await getDirectory(employeeId)

      await ensureUser({ loginId: employeeId, name: empDir?.name || employeeId, role: 'LEAVE_USER', isActive })

      let prof = await LeaveProfile.findOne({ employeeId })
      const existed = !!prof
      if (!prof) {
        prof = new LeaveProfile({
          employeeId,
          employeeLoginId: employeeId,
        })
      }

      prof.managerLoginId = managerEmployeeId
      prof.gmLoginId = gmLoginId
      prof.joinDate = joinDate || prof.joinDate || ''
      prof.contractDate = contractDate || prof.contractDate || ''
      prof.alCarry = alCarry
      prof.isActive = isActive

      prof.name = empDir?.name || prof.name || ''
      prof.department = empDir?.department || prof.department || ''

      if (prof.joinDate && isValidYMD(prof.joinDate)) {
        const asOf = nowYMD()
        prof.balances = recalcBalances(prof, asOf)
        prof.balancesAsOf = asOf
      }

      await prof.save()
      if (existed) updatedCount += 1
      else createdCount += 1
    }

    res.json({ ok: true, createdCount, updatedCount, skippedCount })
  } catch (e) {
    console.error('createManagerWithEmployees error', e)
    res.status(400).json({ message: e.message || 'Failed to create manager/employees.' })
  }
}

async function updateProfile(req, res) {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    const joinDate = req.body.joinDate ? assertYMD(req.body.joinDate, 'joinDate') : ''
    const contractDate = req.body.contractDate ? assertYMD(req.body.contractDate, 'contractDate') : ''

    const managerLoginId = String(req.body.managerLoginId || doc.managerLoginId || '').trim()
    const gmLoginId = String(req.body.gmLoginId || doc.gmLoginId || '').trim()
    if (!managerLoginId) return res.status(400).json({ message: 'managerLoginId is required.' })
    if (!gmLoginId) return res.status(400).json({ message: 'gmLoginId is required.' })

    doc.joinDate = joinDate || doc.joinDate || ''
    doc.contractDate = contractDate || doc.contractDate || ''
    doc.managerLoginId = managerLoginId
    doc.gmLoginId = gmLoginId
    doc.alCarry = num(req.body.alCarry)
    doc.isActive = req.body.isActive !== false

    // refresh name/department from directory
    const empDir = await getDirectory(employeeId)
    if (empDir) {
      doc.name = empDir.name || doc.name
      doc.department = empDir.department || doc.department
    }

    // ensure user status updated too
    await ensureUser({ loginId: employeeId, name: doc.name || employeeId, role: 'LEAVE_USER', isActive: doc.isActive })
    const mgrDir = await getDirectory(managerLoginId)
    await ensureUser({ loginId: managerLoginId, name: mgrDir?.name || managerLoginId, role: 'LEAVE_MANAGER', isActive: true })

    // IMPORTANT: recompute + persist balances if joinDate/contractDate changed
    if (doc.joinDate && isValidYMD(doc.joinDate)) {
      const asOf = nowYMD()
      doc.balances = recalcBalances(doc, asOf)
      doc.balancesAsOf = asOf
    }

    await doc.save()
    res.json({ ok: true, profile: doc })
  } catch (e) {
    console.error('updateProfile error', e)
    res.status(400).json({ message: e.message || 'Failed to update profile.' })
  }
}

async function deactivateProfile(req, res) {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    doc.isActive = false
    await doc.save()

    // deactivate user too
    await User.updateOne({ loginId: employeeId }, { $set: { isActive: false } })

    res.json({ ok: true })
  } catch (e) {
    console.error('deactivateProfile error', e)
    res.status(500).json({ message: 'Failed to deactivate.' })
  }
}

module.exports = {
  requireAnyRole,

  getApprovers,
  getProfilesGrouped,
  getProfileOne,

  createProfileSingle,
  createManagerWithEmployees,

  updateProfile,
  deactivateProfile,
}
