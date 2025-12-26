/* eslint-disable no-console */
// backend/controllers/leave/leaveProfiles.admin.controller.js

const bcrypt = require('bcryptjs')
const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

const { computeBalances } = require('../../utils/leave.rules')
const { broadcastLeaveProfile } = require('../../utils/realtime') // ✅ REALTIME

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const DEFAULT_PWD_POLICY = process.env.LEAVE_DEFAULT_PASSWORD || '123456'

const APPROVAL_MODE = Object.freeze(['GM_ONLY', 'GM_AND_COO'])

// ✅ Backend-seeded approvers (frontend does NOT pick persons)
const SEED_GM_LOGINID = String(process.env.LEAVE_GM_LOGINID || 'leave_gm').trim()
const SEED_COO_LOGINID = String(process.env.LEAVE_COO_LOGINID || 'leave_coo').trim()

/* ───────────────── helpers ───────────────── */

function getIo(req) {
  return req.io || req.app?.get('io') || null
}

function emitProfile(req, docOrPlain, event) {
  try {
    const io = getIo(req)
    if (!io) return
    const body =
      typeof docOrPlain?.toObject === 'function' ? docOrPlain.toObject() : docOrPlain
    broadcastLeaveProfile(io, body, event, body)
  } catch (e) {
    console.warn('⚠️ realtime emitProfile failed:', e?.message)
  }
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

function addDaysYMD(ymd, deltaDays) {
  const d = ymdToUTCDate(assertYMD(ymd, 'date'))
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addYearsYMD(ymd, deltaYears) {
  const d = ymdToUTCDate(assertYMD(ymd, 'date'))
  d.setUTCFullYear(d.getUTCFullYear() + Number(deltaYears || 0))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function computeContractEndYMD(startYMD) {
  // end = start + 1 year - 1 day
  return addDaysYMD(addYearsYMD(assertYMD(startYMD, 'contractStart'), 1), -1)
}

/* ───────── auth helpers ───────── */

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

function actorId(req) {
  return String(req.user?.loginId || req.user?.id || req.user?.sub || '')
}

/* ───────── id extract helpers ───────── */

function pickEmployeeId(obj) {
  const a = obj?.employeeId
  const b = obj?.employee?.employeeId
  const c = obj?.selectedEmployee?.employeeId
  return String(a || b || c || '').trim()
}

function pickManagerId(obj) {
  const a = obj?.managerLoginId
  const b = obj?.managerEmployeeId
  const c = obj?.manager?.employeeId
  return String(a || b || c || '').trim()
}

function pickApprovalMode(obj) {
  const v = String(obj?.approvalMode || '').trim().toUpperCase()
  return APPROVAL_MODE.includes(v) ? v : 'GM_ONLY'
}

/* ───────── directory helpers ───────── */

async function getDirectory(empId) {
  const eid = String(empId || '').trim()
  if (!eid) return null
  return EmployeeDirectory.findOne({ employeeId: eid })
    .select('employeeId name department contactNumber telegramChatId isActive')
    .lean()
}

/* ───────── ensure user (safe + multi-role) ───────── */

async function ensureUser({
  loginId,
  name,
  role,
  roles,
  isActive = true,
  telegramChatId = '',
}) {
  const id = String(loginId || '').trim()
  if (!id) return null

  const cleanChatId = String(telegramChatId || '').trim()

  const addRoles = [
    ...(Array.isArray(roles) ? roles : roles ? [roles] : []),
    ...(role ? [role] : []),
  ]
    .map(r => String(r || '').trim().toUpperCase())
    .filter(Boolean)

  const existing = await User.findOne({ loginId: id })

  if (existing) {
    const $set = {}
    const $addToSet = {}

    if (name && existing.name !== name) $set.name = name
    if (typeof isActive === 'boolean' && existing.isActive !== isActive) $set.isActive = isActive
    if (cleanChatId && String(existing.telegramChatId || '') !== cleanChatId) {
      $set.telegramChatId = cleanChatId
    }

    if (addRoles.length) {
      $addToSet.roles = { $each: addRoles }
    }

    const curRole = String(existing.role || '').trim()
    if (!curRole && addRoles.length) {
      $set.role = addRoles[0]
    }

    const update = {}
    if (Object.keys($set).length) update.$set = $set
    if (Object.keys($addToSet).length) update.$addToSet = $addToSet

    if (Object.keys(update).length) {
      return User.findOneAndUpdate({ _id: existing._id }, update, { new: true })
    }

    return existing
  }

  const plainPwd = DEFAULT_PWD_POLICY === 'EMPLOYEE_ID' ? id : DEFAULT_PWD_POLICY
  const passwordHash = await bcrypt.hash(String(plainPwd), 10)

  const mainRole = (addRoles[0] || 'LEAVE_USER').toUpperCase()

  return User.create({
    loginId: id,
    name: name || id,
    role: mainRole,
    roles: addRoles.length ? addRoles : [mainRole],
    passwordHash,
    isActive: !!isActive,
    ...(cleanChatId ? { telegramChatId: cleanChatId } : {}),
  })
}

/* ───────── balances sync ───────── */

async function syncBalancesForProfile(doc, asOfYMD) {
  if (!doc) return
  const asOf = isValidYMD(asOfYMD) ? asOfYMD : nowYMD()

  const approved = await LeaveRequest.find({
    employeeId: String(doc.employeeId || '').trim(),
    status: 'APPROVED',
  })
    .sort({ startDate: 1 })
    .lean()

  const snap = computeBalances(doc, approved, new Date(asOf + 'T00:00:00Z'))
  doc.balances = Array.isArray(snap?.balances) ? snap.balances : []
  doc.balancesAsOf = asOf
}

/* ───────── contract history helpers ───────── */

function ensureContractsInitialized(doc, openedBy = '') {
  if (!Array.isArray(doc.contracts) || doc.contracts.length === 0) {
    const start =
      doc.contractDate && isValidYMD(doc.contractDate)
        ? doc.contractDate
        : doc.joinDate && isValidYMD(doc.joinDate)
          ? doc.joinDate
          : ''

    const end = start ? computeContractEndYMD(start) : ''

    doc.contracts = [
      {
        contractNo: 1,
        startDate: start,
        endDate: end,
        openedAt: new Date(),
        closedAt: null,
        openedBy: openedBy || '',
        closedBy: '',
        note: 'Initial contract',
        closeSnapshot: null,
      },
    ]
  }
}

function getCurrentContract(doc) {
  const arr = Array.isArray(doc.contracts) ? doc.contracts : []
  if (!arr.length) return null
  return arr[arr.length - 1]
}

/* ───────── seeded approvers validation ───────── */

function resolveSeededApprovers(approvalMode) {
  const gmLoginId = SEED_GM_LOGINID
  const cooLoginId = SEED_COO_LOGINID

  if (!gmLoginId) throw new Error('Seed GM missing. Set LEAVE_GM_LOGINID.')
  if (approvalMode === 'GM_AND_COO' && !cooLoginId) {
    throw new Error('Seed COO missing. Set LEAVE_COO_LOGINID for GM_AND_COO mode.')
  }

  return { gmLoginId, cooLoginId: cooLoginId || '' }
}

/* ───────────────── controllers ───────────────── */

async function getApprovers(req, res) {
  try {
    const wanted = ['LEAVE_GM', 'LEAVE_COO', 'LEAVE_ADMIN', 'ADMIN']

    const docs = await User.find({
      isActive: true,
      $or: [{ role: { $in: wanted } }, { roles: { $in: wanted } }],
    })
      .select('loginId name role roles telegramChatId')
      .lean()

    res.json(
      (docs || []).map(d => ({
        loginId: String(d.loginId || ''),
        name: d.name || '',
        role: d.role || '',
        roles: Array.isArray(d.roles) ? d.roles : [],
        telegramChatId: String(d.telegramChatId || ''),
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

    const profiles = await LeaveProfile.find(query)

    const asOf = nowYMD()
    for (const doc of profiles || []) {
      if (doc?.isActive === false) continue
      if (!doc.joinDate || !isValidYMD(doc.joinDate)) continue
      if (!doc.contractDate || !isValidYMD(doc.contractDate)) doc.contractDate = doc.joinDate
      ensureContractsInitialized(doc, actorId(req))
      await syncBalancesForProfile(doc, asOf)
      await doc.save()
    }

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
      const employees = (emps || [])
        .slice()
        .sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)))

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
          contractEndDate: x.contractEndDate || null,

          managerLoginId: x.managerLoginId || '',
          gmLoginId: x.gmLoginId || '',
          cooLoginId: x.cooLoginId || '',
          approvalMode: x.approvalMode || 'GM_ONLY',

          isActive: x.isActive !== false,
          balances: Array.isArray(x.balances) ? x.balances : [],
          contracts: Array.isArray(x.contracts) ? x.contracts : [],
          balancesAsOf: x.balancesAsOf || null,
        })),
      })
    }

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

    if (doc.joinDate && isValidYMD(doc.joinDate) && (!doc.contractDate || !isValidYMD(doc.contractDate))) {
      doc.contractDate = doc.joinDate
    }

    ensureContractsInitialized(doc, actorId(req))
    await syncBalancesForProfile(doc, nowYMD())
    await doc.save()

    res.json({ profile: doc })
  } catch (e) {
    console.error('getProfileOne error', e)
    res.status(500).json({ message: 'Failed to load profile.' })
  }
}

// ✅ single create (manager optional, gm/coo seeded)
async function createProfileSingle(req, res) {
  try {
    const approvalMode = pickApprovalMode(req.body)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(approvalMode)

    const employeeId = pickEmployeeId(req.body)
    const managerLoginId = pickManagerId(req.body)

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required.' })

    const joinDate = req.body.joinDate ? assertYMD(req.body.joinDate, 'joinDate') : ''
    let contractDate = req.body.contractDate ? assertYMD(req.body.contractDate, 'contractDate') : ''
    if (joinDate && !contractDate) contractDate = joinDate

    const isActive = req.body.isActive !== false

    const empDir = await getDirectory(employeeId)
    const mgrDir = managerLoginId ? await getDirectory(managerLoginId) : null

    await ensureUser({
      loginId: employeeId,
      name: empDir?.name || req.body.name || employeeId,
      role: 'LEAVE_USER',
      isActive,
      telegramChatId: empDir?.telegramChatId || '',
    })

    if (managerLoginId) {
      await ensureUser({
        loginId: managerLoginId,
        name: mgrDir?.name || managerLoginId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })

    let prof = await LeaveProfile.findOne({ employeeId })
    if (!prof) prof = new LeaveProfile({ employeeId, employeeLoginId: employeeId })

    prof.approvalMode = approvalMode
    prof.managerLoginId = managerLoginId || ''
    prof.gmLoginId = gmLoginId
    prof.cooLoginId = cooLoginId || ''

    prof.joinDate = joinDate || prof.joinDate || ''
    prof.contractDate = contractDate || prof.contractDate || ''
    prof.isActive = isActive

    prof.name = empDir?.name || prof.name || ''
    prof.department = empDir?.department || prof.department || ''

    ensureContractsInitialized(prof, actorId(req))
    await syncBalancesForProfile(prof, nowYMD())
    await prof.save()

    // ✅ REALTIME
    emitProfile(req, prof, 'leave:profile:created')
    emitProfile(req, prof, 'leave:profile:updated')

    res.json({ ok: true, profile: prof })
  } catch (e) {
    console.error('createProfileSingle error', e)
    res.status(400).json({ message: e.message || 'Failed to create profile.' })
  }
}

// ✅ bulk create (manager OPTIONAL now, gm/coo seeded)
async function createManagerWithEmployees(req, res) {
  try {
    const approvalMode = pickApprovalMode(req.body)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(approvalMode)

    const managerEmployeeId = pickManagerId(req.body)
    const employees = Array.isArray(req.body.employees) ? req.body.employees : []
    if (!employees.length) return res.status(400).json({ message: 'employees[] is required.' })

    if (managerEmployeeId) {
      const mgrDir = await getDirectory(managerEmployeeId)
      await ensureUser({
        loginId: managerEmployeeId,
        name: mgrDir?.name || managerEmployeeId,
        role: 'LEAVE_MANAGER',
        isActive: true,
        telegramChatId: mgrDir?.telegramChatId || '',
      })
    }

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })
    else if (SEED_COO_LOGINID) {
      await ensureUser({ loginId: SEED_COO_LOGINID, name: SEED_COO_LOGINID, role: 'LEAVE_COO', isActive: true })
    }

    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0

    for (const row of employees) {
      const employeeId = pickEmployeeId(row)
      if (!employeeId) {
        skippedCount += 1
        continue
      }

      const joinDate = row.joinDate ? assertYMD(row.joinDate, 'joinDate') : ''
      let contractDate = row.contractDate ? assertYMD(row.contractDate, 'contractDate') : ''
      if (joinDate && !contractDate) contractDate = joinDate

      const isActive = row.isActive !== false
      const empDir = await getDirectory(employeeId)

      await ensureUser({
        loginId: employeeId,
        name: empDir?.name || employeeId,
        role: 'LEAVE_USER',
        isActive,
        telegramChatId: empDir?.telegramChatId || '',
      })

      let prof = await LeaveProfile.findOne({ employeeId })
      const existed = !!prof
      if (!prof) prof = new LeaveProfile({ employeeId, employeeLoginId: employeeId })

      prof.approvalMode = approvalMode
      prof.managerLoginId = managerEmployeeId || ''
      prof.gmLoginId = gmLoginId
      prof.cooLoginId = cooLoginId || (SEED_COO_LOGINID || '')

      prof.joinDate = joinDate || prof.joinDate || ''
      prof.contractDate = contractDate || prof.contractDate || ''
      prof.isActive = isActive

      prof.name = empDir?.name || prof.name || ''
      prof.department = empDir?.department || prof.department || ''

      ensureContractsInitialized(prof, actorId(req))
      await syncBalancesForProfile(prof, nowYMD())
      await prof.save()

      // ✅ REALTIME (emit per employee)
      emitProfile(req, prof, existed ? 'leave:profile:updated' : 'leave:profile:created')

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

    const approvalMode = pickApprovalMode(req.body)
    const { gmLoginId, cooLoginId } = resolveSeededApprovers(approvalMode)

    const joinDate = req.body.joinDate ? assertYMD(req.body.joinDate, 'joinDate') : ''

    if (req.body.contractDate && String(req.body.contractDate).trim() !== String(doc.contractDate || '').trim()) {
      return res.status(400).json({
        message: 'To change/renew contract date, use Renew Contract endpoint so history is applied.',
      })
    }

    const managerLoginId = pickManagerId(req.body) || ''

    doc.approvalMode = approvalMode
    doc.managerLoginId = managerLoginId
    doc.gmLoginId = gmLoginId
    doc.cooLoginId = cooLoginId || (SEED_COO_LOGINID || '')
    doc.joinDate = joinDate || doc.joinDate || ''
    doc.isActive = req.body.isActive !== false

    if (doc.joinDate && isValidYMD(doc.joinDate) && (!doc.contractDate || !isValidYMD(doc.contractDate))) {
      doc.contractDate = doc.joinDate
    }

    const empDir = await getDirectory(employeeId)
    if (empDir) {
      doc.name = empDir.name || doc.name
      doc.department = empDir.department || doc.department
    }

    ensureContractsInitialized(doc, actorId(req))
    await syncBalancesForProfile(doc, nowYMD())
    await doc.save()

    await ensureUser({ loginId: gmLoginId, name: gmLoginId, role: 'LEAVE_GM', isActive: true })
    if (cooLoginId) await ensureUser({ loginId: cooLoginId, name: cooLoginId, role: 'LEAVE_COO', isActive: true })
    if (managerLoginId) await ensureUser({ loginId: managerLoginId, name: managerLoginId, role: 'LEAVE_MANAGER', isActive: true })

    // ✅ REALTIME
    emitProfile(req, doc, 'leave:profile:updated')

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

    await User.updateOne({ loginId: employeeId }, { $set: { isActive: false } })

    // ✅ REALTIME
    emitProfile(req, doc, 'leave:profile:deactivated')
    emitProfile(req, doc, 'leave:profile:updated')

    res.json({ ok: true })
  } catch (e) {
    console.error('deactivateProfile error', e)
    res.status(500).json({ message: 'Failed to deactivate.' })
  }
}

async function renewContract(req, res) {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const doc = await LeaveProfile.findOne({ employeeId })
    if (!doc) return res.status(404).json({ message: 'Profile not found.' })

    const newContractDate = assertYMD(req.body.newContractDate, 'newContractDate')
    const note = String(req.body.note || '').trim()

    if (!doc.joinDate || !isValidYMD(doc.joinDate)) {
      return res.status(400).json({ message: 'joinDate is required before renewing contract.' })
    }

    if (ymdToUTCDate(newContractDate).getTime() < ymdToUTCDate(doc.joinDate).getTime()) {
      return res.status(400).json({ message: 'newContractDate cannot be before joinDate.' })
    }

    ensureContractsInitialized(doc, actorId(req))
    const current = getCurrentContract(doc)

    const curStart =
      doc.contractDate && isValidYMD(doc.contractDate)
        ? doc.contractDate
        : current?.startDate && isValidYMD(current.startDate)
          ? current.startDate
          : doc.joinDate

    if (newContractDate <= curStart) {
      return res.status(400).json({ message: 'newContractDate must be after current contract start date.' })
    }

    const closeYmd = addDaysYMD(newContractDate, -1)

    if (current) {
      current.endDate = closeYmd
      current.closedAt = new Date()
      current.closedBy = actorId(req)
      if (note) current.note = note
      current.closeSnapshot = {
        asOf: closeYmd,
        balances: Array.isArray(doc.balances) ? doc.balances : [],
        alCarry: 0,
        contractDate: String(doc.contractDate || curStart || ''),
      }
    }

    const nextNo = Number(current?.contractNo || doc.contracts.length) + 1
    const newEnd = computeContractEndYMD(newContractDate)

    doc.contracts.push({
      contractNo: nextNo,
      startDate: newContractDate,
      endDate: newEnd,
      openedAt: new Date(),
      closedAt: null,
      openedBy: actorId(req),
      closedBy: '',
      note: note ? `New contract · ${note}` : 'New contract',
      closeSnapshot: null,
    })

    doc.contractDate = newContractDate

    await syncBalancesForProfile(doc, nowYMD())
    await doc.save()

    // ✅ REALTIME
    emitProfile(req, doc, 'leave:profile:renewed')
    emitProfile(req, doc, 'leave:profile:updated')

    return res.json({
      ok: true,
      employeeId,
      renewed: {
        newContractDate,
        newContractEndDate: newEnd,
        closedContractNo: current?.contractNo || null,
        openedContractNo: nextNo,
        closeAsOf: closeYmd,
      },
      profile: doc,
    })
  } catch (e) {
    console.error('renewContract error', e)
    return res.status(400).json({ message: e.message || 'Failed to renew contract.' })
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

  renewContract,
}
