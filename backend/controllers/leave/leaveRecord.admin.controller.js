/* eslint-disable no-console */
// backend/controllers/leave/leaveRecord.admin.controller.js

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const { computeBalances } = require('../../utils/leave.rules')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const PP_OFFSET_MINUTES = 7 * 60 // UTC+7

// ───────────────── helpers ─────────────────

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function safeText(v) {
  return String(v ?? '').trim()
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

function assertYMD(s, label = 'date') {
  const v = String(s || '').trim()
  if (!isValidYMD(v)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD, got "${s}"`)
  return v
}

/** Convert Date/ISO/string to YYYY-MM-DD (UTC). Returns '' if invalid. */
function toYMD(v) {
  if (!v) return ''
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    if (isValidYMD(s)) return s
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  }
  try {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
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

/**
 * Phnom Penh midnight Date for a YMD (prevents timezone drift).
 * PP 00:00 == UTC previous day 17:00.
 */
function phnomPenhMidnightDate(ymd) {
  const s = String(ymd || '').trim()
  if (!isValidYMD(s)) return new Date()
  const [y, m, d] = s.split('-').map((x) => Number(x))
  const utcMidnight = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0)
  const ppMidnightUtc = utcMidnight - PP_OFFSET_MINUTES * 60 * 1000
  return new Date(ppMidnightUtc)
}

function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => String(x || '').toUpperCase().trim()))].filter(Boolean)
}

function getRoles(req) {
  const roles = []
  if (req.user?.role) roles.push(req.user.role)
  if (Array.isArray(req.user?.roles)) roles.push(...req.user.roles)
  return uniqUpper(roles)
}

function isAdminViewer(req) {
  const roles = getRoles(req)
  return roles.includes('LEAVE_ADMIN') || roles.includes('ADMIN') || roles.includes('ROOT_ADMIN')
}

/** ✅ support old numeric employeeId data + new string employeeId */
function buildEmpIdIn(employeeId) {
  const s = String(employeeId || '').trim()
  const n = Number(s)
  const list = [s]
  if (Number.isFinite(n)) list.push(n)
  return { $in: [...new Set(list)] }
}

// Overlap if startA <= endB && endA >= startB
function overlapsRange(docStart, docEnd, from, to) {
  if (!from || !to) return true
  const s = toYMD(docStart) || ''
  const e = toYMD(docEnd) || s
  if (!s) return false
  return s <= to && e >= from
}

/** Map system leaveTypeCode to PDF column codes */
function mapToPdfCode(systemCode) {
  const c = String(systemCode || '').toUpperCase().trim()
  if (c === 'MC') return 'SL' // Medical Certificate → Sick Leave column on paper
  if (c === 'MA') return 'ML' // Maternity Leave code in system → ML column on paper
  return c
}

/** For PDF columns: AL includes SP (borrow from AL) */
function shouldCountAsAL(systemCode) {
  const c = String(systemCode || '').toUpperCase().trim()
  return c === 'AL' || c === 'SP'
}

async function loadDirMap(ids = []) {
  const uniq = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))]
  if (!uniq.length) return new Map()

  const rows = await EmployeeDirectory.find(
    { employeeId: { $in: uniq } },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1, section: 1 }
  ).lean()

  const map = new Map()
  for (const r of rows || []) map.set(String(r.employeeId), r)
  return map
}

function displayName(dirRow, fallback = '') {
  return safeText(dirRow?.name || dirRow?.fullName || fallback || '')
}

// ───────────────── controller ─────────────────

/**
 * GET /api/admin/leave/reports/employee/:employeeId/record
 * Query:
 *  - from=YYYY-MM-DD
 *  - to=YYYY-MM-DD
 *  - statuses=APPROVED,PENDING_MANAGER,PENDING_GM  (optional)
 *
 * Returns:
 *  - meta header for “Leave Record - Foreigner”
 *  - rows for the table (PDF columns)
 *  - approvers object (names + signature placeholders)
 */
exports.getEmployeeLeaveRecord = async (req, res) => {
  try {
    if (!isAdminViewer(req)) return res.status(403).json({ message: 'Forbidden' })

    const employeeId = String(req.params.employeeId || '').trim()
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    const from = req.query.from ? assertYMD(req.query.from, 'from') : ''
    const to = req.query.to ? assertYMD(req.query.to, 'to') : ''
    if ((from && !to) || (!from && to)) {
      return res.status(400).json({ message: 'from and to must be provided together.' })
    }
    if (from && to && from > to) {
      return res.status(400).json({ message: 'from cannot be after to.' })
    }

    // ✅ default: include approved + pending so "has data" will show on PDF preview
    const statuses = safeText(req.query.statuses)
      ? safeText(req.query.statuses)
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : ['APPROVED', 'PENDING_MANAGER', 'PENDING_GM']

    // profile
    const profile =
      (await LeaveProfile.findOne({ employeeId }).lean()) ||
      (await LeaveProfile.findOne({ employeeId: Number(employeeId) }).lean())

    if (!profile) return res.status(404).json({ message: 'Leave profile not found.' })

    // directory (employee)
    const dirEmp = await EmployeeDirectory.findOne(
      { employeeId },
      { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1, section: 1 }
    ).lean()

    const empName = displayName(dirEmp, profile?.name)
    const dept = safeText(dirEmp?.departmentName || dirEmp?.department || profile?.department || '')
    const section = safeText(dirEmp?.section || 'Foreigner')

    // requests for this employee
    let docs = await LeaveRequest.find({
      employeeId: buildEmpIdIn(employeeId),
      status: { $in: statuses },
    })
      .sort({ startDate: 1, createdAt: 1 })
      .lean()

    // filter by range overlap if provided
    if (from && to) {
      docs = (docs || []).filter((r) => overlapsRange(r.startDate, r.endDate, from, to))
    }

    // Load names for recordBy/checkedBy/manager/gm if you have them as IDs in EmployeeDirectory
    const idsToResolve = new Set()
    idsToResolve.add(String(profile.managerLoginId || '').trim())
    idsToResolve.add(String(profile.gmLoginId || '').trim())

    for (const r of docs || []) {
      idsToResolve.add(String(r.managerLoginId || '').trim())
      idsToResolve.add(String(r.gmLoginId || '').trim())
      idsToResolve.add(String(r.createdByLoginId || r.createdBy || '').trim())
      idsToResolve.add(String(r.checkedByLoginId || r.checkedBy || '').trim())
    }

    const dirMap = await loadDirMap([...idsToResolve])

    const managerId = safeText(profile.managerLoginId)
    const gmId = safeText(profile.gmLoginId)

    const approvers = {
      manager: {
        loginId: managerId,
        name: displayName(dirMap.get(managerId), managerId),
        signatureUrl: '', // TODO: you will provide signature images later
      },
      gm: {
        loginId: gmId,
        name: displayName(dirMap.get(gmId), gmId),
        signatureUrl: '', // TODO
      },
    }

    // Build rows for PDF table
    // ✅ AL Remain should reflect balances after each APPROVED row
    // Use only approved history for remain calculation (official record).
    const approvedHistAll = (docs || []).filter((r) => String(r.status || '').toUpperCase() === 'APPROVED')

    const rows = []
    for (let i = 0; i < (docs || []).length; i++) {
      const r = docs[i]
      const systemCode = String(r.leaveTypeCode || '').toUpperCase()
      const pdfCode = mapToPdfCode(systemCode)
      const days = num(r.totalDays)
      const st = String(r.status || '').toUpperCase()

      // compute AL remain only when this row is approved (matches “record” meaning)
      let alRemain = ''
      if (st === 'APPROVED') {
        // approved history up to this approved row (not up to i in docs, because docs includes pending)
        const approvedUpTo = approvedHistAll.filter((x) => {
          const ax = String(x._id || '')
          const rx = String(r._id || '')
          // include all approved before or equal in chronological order:
          // easiest: compare startDate/createdAt; but stable with array slice:
          // we will just compute using approvedHistAll index when matching id.
          return true
        })

        // find this row position in approvedHistAll
        const idxApproved = approvedHistAll.findIndex((x) => String(x._id) === String(r._id))
        const hist = idxApproved >= 0 ? approvedHistAll.slice(0, idxApproved + 1) : approvedHistAll

        const asOf = toYMD(r.endDate || r.startDate) || nowYMD()
        const asOfDate = phnomPenhMidnightDate(asOf)
        const snap = computeBalances(profile, hist, asOfDate)
        const alRow = (snap?.balances || []).find((b) => String(b.leaveTypeCode || '').toUpperCase() === 'AL')
        alRemain = num(alRow?.remaining)
      }

      // names
      const recordById = safeText(r.createdByLoginId || r.createdBy || '')
      const checkedById = safeText(r.checkedByLoginId || r.checkedBy || '')
      const managerRowId = safeText(r.managerLoginId || profile.managerLoginId || '')
      const gmRowId = safeText(r.gmLoginId || profile.gmLoginId || '')

      // remark rules
      let remark = safeText(r.remark || r.note || '')
      if (systemCode === 'SP') {
        remark = remark ? `SP (Borrow from AL) • ${remark}` : 'SP (Borrow from AL)'
      }
      if (st !== 'APPROVED') {
        remark = remark ? `[${st}] ${remark}` : `[${st}]`
      }

      rows.push({
        // Left columns
        date: toYMD(r.createdAt || r.startDate),
        from: toYMD(r.startDate),
        to: toYMD(r.endDate || r.startDate),

        // PDF columns
        AL_day: shouldCountAsAL(systemCode) ? days : '',
        AL_remain: shouldCountAsAL(systemCode) ? alRemain : '',

        UL_day: pdfCode === 'UL' ? days : '',
        SL_day: pdfCode === 'SL' ? days : '',
        ML_day: pdfCode === 'ML' ? days : '',

        // Names (for printing + signatures later)
        recordBy: displayName(dirMap.get(recordById), recordById),
        recordByLoginId: recordById,

        checkedBy: displayName(dirMap.get(checkedById), checkedById),
        checkedByLoginId: checkedById,

        approvedManager: displayName(dirMap.get(managerRowId), managerRowId),
        approvedManagerLoginId: managerRowId,

        approvedGM: displayName(dirMap.get(gmRowId), gmRowId),
        approvedGMLoginId: gmRowId,

        remark,

        // keep original info (helpful for debugging / UI)
        status: st,
        leaveTypeCode: systemCode,
      })
    }

    return res.json({
      meta: {
        employeeId,
        name: empName,
        department: dept,
        section,
        joinDate: toYMD(profile.joinDate),

        // your PDF legend
        leaveTypeLegend: {
          AL: 'Annual Leave',
          SL: 'Sick Leave',
          ML: 'Maternity Leave',
          UL: 'Unpaid Leave',
        },

        // show what backend used
        range: { from: from || null, to: to || null },
        statusesUsed: statuses,
      },

      approvers, // includes signatureUrl placeholders
      rows,
    })
  } catch (e) {
    console.error('getEmployeeLeaveRecord error', e)
    return res.status(500).json({ message: e.message || 'Failed to load employee leave record' })
  }
}
