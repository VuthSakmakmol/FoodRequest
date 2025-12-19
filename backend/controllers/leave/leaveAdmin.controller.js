// backend/controllers/leave/leaveAdmin.controller.js
const bcrypt = require('bcryptjs')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const User = require('../../models/User')

function escNum(n) {
  const v = Number(n ?? 0)
  return Number.isFinite(v) ? v : 0
}

async function findDirectoryMap(employeeIds = []) {
  const ids = [...new Set(employeeIds.map(x => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) return new Map()

  const rows = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, department: 1 }
  ).lean()

  const map = new Map()
  for (const r of rows) map.set(String(r.employeeId), r)
  return map
}

async function ensureUser({ loginId, name, role }) {
  const id = String(loginId || '').trim()
  if (!id) return { ok: false, reason: 'missing loginId' }

  const existing = await User.findOne({ loginId: id })
  if (existing) return { ok: true, created: false, user: existing }

  // ✅ default password (change later if you want)
  const passwordHash = await bcrypt.hash('123456', 10)

  const doc = await User.create({
    loginId: id,
    name: name || id,
    role,
    passwordHash,
    isActive: true,
  })

  return { ok: true, created: true, user: doc }
}

/** GET /api/admin/leave/approvers */
exports.getApprovers = async (req, res) => {
  try {
    // Only GM list for dropdown
    const gms = await User.find(
      { role: 'LEAVE_GM', isActive: true },
      { loginId: 1, name: 1, role: 1 }
    ).lean()

    res.json(
      (gms || []).map(x => ({
        loginId: String(x.loginId || ''),
        name: x.name || '',
        role: x.role || 'LEAVE_GM',
      }))
    )
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load approvers' })
  }
}

/** GET /api/admin/leave/profiles/grouped */
exports.getGroupedProfiles = async (req, res) => {
  try {
    const profiles = await LeaveProfile.find({ isActive: true }).lean()

    // collect manager ids + employee ids for directory join
    const allIds = []
    for (const p of profiles) {
      allIds.push(String(p.employeeId || ''))
      allIds.push(String(p.managerLoginId || ''))
    }

    const dirMap = await findDirectoryMap(allIds)

    // group by managerLoginId
    const byMgr = new Map()
    for (const p of profiles) {
      const mgrId = String(p.managerLoginId || '').trim() || '—'
      if (!byMgr.has(mgrId)) byMgr.set(mgrId, [])
      byMgr.get(mgrId).push({
        ...p,
        employeeId: String(p.employeeId || ''),
        managerLoginId: String(p.managerLoginId || ''),
        gmLoginId: String(p.gmLoginId || ''),
        alCarry: escNum(p.alCarry),
        balances: Array.isArray(p.balances) ? p.balances : [],
        name: dirMap.get(String(p.employeeId || ''))?.name || p.name || '',
        department: dirMap.get(String(p.employeeId || ''))?.department || p.department || '',
      })
    }

    const groups = []
    for (const [mgrId, emps] of byMgr.entries()) {
      const mgrDir = dirMap.get(mgrId) || {}
      groups.push({
        manager: {
          employeeId: mgrId,
          name: mgrDir.name || '',
          department: mgrDir.department || '',
        },
        employees: emps.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId))),
      })
    }

    groups.sort((a, b) => String(a.manager.employeeId).localeCompare(String(b.manager.employeeId)))

    res.json(groups)
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load grouped profiles' })
  }
}

/** GET /api/admin/leave/profiles */
exports.listProfiles = async (req, res) => {
  try {
    const rows = await LeaveProfile.find({}).lean()
    res.json(rows || [])
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load profiles' })
  }
}

/** GET /api/admin/leave/profiles/:employeeId */
exports.getProfile = async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const profile = await LeaveProfile.findOne({ employeeId }).lean()
    if (!profile) return res.status(404).json({ message: 'Profile not found' })
    res.json({ profile })
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load profile' })
  }
}

/** POST /api/admin/leave/profiles
 *  Also creates User LEAVE_USER if missing
 */
exports.createProfile = async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId || '').trim()
    const managerLoginId = String(req.body.managerLoginId || '').trim()
    const gmLoginId = String(req.body.gmLoginId || '').trim()

    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })
    if (!managerLoginId) return res.status(400).json({ message: 'managerLoginId is required' })
    if (!gmLoginId) return res.status(400).json({ message: 'gmLoginId is required' })

    const exists = await LeaveProfile.findOne({ employeeId })
    if (exists) {
      // if exists but inactive, you may want to re-activate:
      // await LeaveProfile.updateOne({ employeeId }, { $set: { isActive: true } })
      return res.json({ skipped: true, message: 'Profile already exists' })
    }

    // directory info for name/department
    const dir = await EmployeeDirectory.findOne({ employeeId }).lean()

    const doc = await LeaveProfile.create({
      employeeId,
      employeeLoginId: employeeId,
      managerLoginId,
      gmLoginId,
      joinDate: req.body.joinDate || null,
      contractDate: req.body.contractDate || null,
      alCarry: escNum(req.body.alCarry),
      isActive: req.body.isActive !== false,
      name: dir?.name || '',
      department: dir?.department || '',
      balances: Array.isArray(req.body.balances) ? req.body.balances : [],
    })

    // ✅ create LEAVE_USER login (if missing)
    await ensureUser({
      loginId: employeeId,
      name: dir?.name || employeeId,
      role: 'LEAVE_USER',
    })

    res.status(201).json({ ok: true, profile: doc })
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to create profile' })
  }
}

/** PUT /api/admin/leave/profiles/:employeeId */
exports.updateProfile = async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    const patch = {}

    if ('joinDate' in req.body) patch.joinDate = req.body.joinDate || null
    if ('contractDate' in req.body) patch.contractDate = req.body.contractDate || null
    if ('managerLoginId' in req.body) patch.managerLoginId = String(req.body.managerLoginId || '').trim()
    if ('gmLoginId' in req.body) patch.gmLoginId = String(req.body.gmLoginId || '').trim()
    if ('isActive' in req.body) patch.isActive = req.body.isActive !== false
    if ('alCarry' in req.body) patch.alCarry = escNum(req.body.alCarry)

    const updated = await LeaveProfile.findOneAndUpdate(
      { employeeId },
      { $set: patch },
      { new: true }
    )

    if (!updated) return res.status(404).json({ message: 'Profile not found' })

    res.json({ ok: true, profile: updated })
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to update profile' })
  }
}

/** DELETE /api/admin/leave/profiles/:employeeId
 *  soft deactivate (keeps for history)
 */
exports.deactivateProfile = async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId || '').trim()

    const prof = await LeaveProfile.findOneAndUpdate(
      { employeeId },
      { $set: { isActive: false } },
      { new: true }
    )

    // also deactivate user login if exists
    await User.updateOne({ loginId: employeeId }, { $set: { isActive: false } })

    if (!prof) return res.status(404).json({ message: 'Profile not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to deactivate profile' })
  }
}

/** POST /api/admin/leave/managers
 *  { managerEmployeeId, gmLoginId, employees:[{employeeId,joinDate,contractDate,alCarry,isActive}] }
 *  Also creates User LEAVE_MANAGER + LEAVE_USER
 */
exports.createManagerWithEmployees = async (req, res) => {
  try {
    const managerEmployeeId = String(req.body.managerEmployeeId || '').trim()
    const gmLoginId = String(req.body.gmLoginId || '').trim()
    const employees = Array.isArray(req.body.employees) ? req.body.employees : []

    if (!managerEmployeeId) return res.status(400).json({ message: 'managerEmployeeId is required' })
    if (!gmLoginId) return res.status(400).json({ message: 'gmLoginId is required' })
    if (!employees.length) return res.status(400).json({ message: 'employees is required' })

    const mgrDir = await EmployeeDirectory.findOne({ employeeId: managerEmployeeId }).lean()

    // ✅ create manager login (if missing)
    await ensureUser({
      loginId: managerEmployeeId,
      name: mgrDir?.name || managerEmployeeId,
      role: 'LEAVE_MANAGER',
    })

    let createdCount = 0
    let skippedCount = 0

    for (const e of employees) {
      const employeeId = String(e.employeeId || '').trim()
      if (!employeeId) { skippedCount++; continue }

      const exists = await LeaveProfile.findOne({ employeeId })
      if (exists) { skippedCount++; continue }

      const dir = await EmployeeDirectory.findOne({ employeeId }).lean()

      await LeaveProfile.create({
        employeeId,
        employeeLoginId: employeeId,
        managerLoginId: managerEmployeeId,
        gmLoginId,
        joinDate: e.joinDate || null,
        contractDate: e.contractDate || null,
        alCarry: escNum(e.alCarry),
        isActive: e.isActive !== false,
        name: dir?.name || '',
        department: dir?.department || '',
        balances: [],
      })

      // ✅ create employee login (if missing)
      await ensureUser({
        loginId: employeeId,
        name: dir?.name || employeeId,
        role: 'LEAVE_USER',
      })

      createdCount++
    }

    res.json({ ok: true, createdCount, skippedCount })
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to create manager + employees' })
  }
}
