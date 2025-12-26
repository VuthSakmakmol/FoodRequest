/* eslint-disable no-console */
// backend/controllers/leave/leaveReport.admin.controller.js

const LeaveProfile      = require('../../models/leave/LeaveProfile')
const LeaveRequest      = require('../../models/leave/LeaveRequest')
const ReplaceDayRequest = require('../../models/leave/ReplaceDayRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')
const LeaveType         = require('../../models/leave/LeaveType')

const { computeBalances } = require('../../utils/leave.rules')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'
const PP_OFFSET_MINUTES = 7 * 60 // UTC+7

// ───────────────── helpers ─────────────────

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => String(x || '').toUpperCase().trim()))].filter(Boolean)
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

// Overlap if startA <= endB && endA >= startB
function overlapsRange(docStart, docEnd, from, to) {
  if (!from || !to) return true
  const s = toYMD(docStart) || ''
  const e = toYMD(docEnd) || s // if end missing, treat as 1-day
  if (!s) return false
  return s <= to && e >= from
}

function monthKey(anyDate) {
  const ymd = toYMD(anyDate)
  return ymd ? ymd.slice(0, 7) : '—'
}

function buildTypeOrder(leaveTypesRows = []) {
  const codes = (leaveTypesRows || [])
    .map((t) => String(t?.code || '').toUpperCase().trim())
    .filter(Boolean)
  const fallback = ['AL', 'SP', 'MC', 'MA', 'UL']
  return [...new Set([...fallback, ...codes])]
}

function findBalanceRow(snapshot, code) {
  return (
    (snapshot?.balances || []).find(
      (b) => String(b.leaveTypeCode).toUpperCase() === String(code).toUpperCase()
    ) || null
  )
}

/**
 * ✅ Pending usage reservation (match strict request behavior)
 * - Use a meta window (contractYear or joinYear) when available.
 * - AL/SP/MC/MA: count pending inside that window.
 * - UL: unlimited (no strict reserve needed).
 */
function computePendingUsage(pendingDocs = [], yearMeta) {
  const start = String(yearMeta?.startDate || '')
  const end = String(yearMeta?.endDate || '')

  const inWindow = (d) => {
    const s = toYMD(d?.startDate || '')
    return start && end ? s >= start && s <= end : true // if no window provided, count all
  }

  const sum = (code, docs) =>
    (docs || [])
      .filter((r) => String(r.leaveTypeCode || '').toUpperCase() === code)
      .reduce((acc, r) => acc + Number(r.totalDays || 0), 0)

  const inRange = (pendingDocs || []).filter(inWindow)

  const pendingAL = sum('AL', inRange)
  const pendingSP = sum('SP', inRange)
  const pendingMC = sum('MC', inRange)
  const pendingMA = sum('MA', inRange)

  return { pendingAL, pendingSP, pendingMC, pendingMA }
}

function computeStrictRemaining(snapshot, pendingUsage) {
  const rem = (code) => Number(findBalanceRow(snapshot, code)?.remaining ?? 0)

  const strict = {
    // ✅ match your createMyRequest strict logic (AL is affected by pending AL + pending SP)
    AL: rem('AL') - (num(pendingUsage.pendingAL) + num(pendingUsage.pendingSP)),
    SP: rem('SP') - num(pendingUsage.pendingSP),
    MC: rem('MC') - num(pendingUsage.pendingMC),
    MA: rem('MA') - num(pendingUsage.pendingMA),
    UL: rem('UL'),
  }

  for (const k of Object.keys(strict)) strict[k] = Number(strict[k] || 0)
  return strict
}

/** ✅ important: support old numeric employeeId data + new string employeeId */
function buildEmployeeIdInQuery(employeeIds = []) {
  const strIds = [...new Set(employeeIds.map((x) => String(x || '').trim()).filter(Boolean))]
  const numIds = strIds
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
  return { $in: [...new Set([...strIds, ...numIds])] }
}

async function loadDirectoryMap(employeeIds = []) {
  const ids = [...new Set(employeeIds.map((x) => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) return new Map()

  const rows = await EmployeeDirectory.find(
    { employeeId: { $in: ids } },
    { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1 }
  ).lean()

  const map = new Map()
  for (const r of rows || []) map.set(String(r.employeeId), r)
  return map
}

// ───────────────── controller ─────────────────

/**
 * GET /api/admin/leave/reports/summary
 * Query:
 *  - q
 *  - includeInactive=1
 *  - managerLoginId (or managerEmployeeId)
 *  - department
 *  - dateFrom/dateTo OR from/to (YYYY-MM-DD)
 *  - asOf (YYYY-MM-DD) default today
 *  - limit (recent list size) default 20, max 200
 */
exports.getLeaveReportSummary = async (req, res) => {
  try {
    if (!isAdminViewer(req)) return res.status(403).json({ message: 'Forbidden' })

    const q = String(req.query.q || '').trim().toLowerCase()
    const includeInactive = String(req.query.includeInactive || '') === '1'
    const managerLoginId = String(req.query.managerLoginId || req.query.managerEmployeeId || '').trim()
    const departmentQ = String(req.query.department || '').trim().toLowerCase()

    // ✅ accept both dateFrom/dateTo and from/to
    const rawFrom = req.query.dateFrom ?? req.query.from ?? ''
    const rawTo = req.query.dateTo ?? req.query.to ?? ''

    const dateFrom = rawFrom ? assertYMD(rawFrom, 'dateFrom') : ''
    const dateTo = rawTo ? assertYMD(rawTo, 'dateTo') : ''

    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
      return res.status(400).json({ message: 'dateFrom and dateTo must be provided together.' })
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return res.status(400).json({ message: 'dateFrom cannot be after dateTo.' })
    }

    const asOf = req.query.asOf ? assertYMD(req.query.asOf, 'asOf') : nowYMD()
    const asOfDate = phnomPenhMidnightDate(asOf)

    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 200)

    // type order
    const leaveTypes = await LeaveType.find({})
      .sort({ order: 1, code: 1 })
      .select('code order isActive isSystem')
      .lean()

    const TYPE_ORDER = buildTypeOrder(leaveTypes)

    // profiles query
    const profQuery = includeInactive ? {} : { isActive: { $ne: false } }
    if (managerLoginId) profQuery.managerLoginId = managerLoginId

    const profiles = await LeaveProfile.find(profQuery).lean()

    // join directory (employee + manager)
    const allIds = []
    for (const p of profiles || []) {
      allIds.push(String(p.employeeId || ''))
      allIds.push(String(p.managerLoginId || ''))
    }
    const dirMap = await loadDirectoryMap(allIds)

    // enrich and in-memory filters
    let filteredProfiles = (profiles || []).map((p) => {
      const empId = String(p.employeeId || '').trim()
      const dir = dirMap.get(empId) || {}

      return {
        ...p,
        employeeId: empId,
        name: dir?.name || dir?.fullName || p.name || '',
        department: dir?.departmentName || dir?.department || p.department || '',
        managerLoginId: String(p.managerLoginId || '').trim(),
        gmLoginId: String(p.gmLoginId || '').trim(),
      }
    })

    if (departmentQ) {
      filteredProfiles = filteredProfiles.filter((p) =>
        String(p.department || '').toLowerCase().includes(departmentQ)
      )
    }

    if (q) {
      filteredProfiles = filteredProfiles.filter((p) => (
        String(p.employeeId || '').toLowerCase().includes(q) ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.department || '').toLowerCase().includes(q) ||
        String(p.managerLoginId || '').toLowerCase().includes(q) ||
        String(p.gmLoginId || '').toLowerCase().includes(q)
      ))
    }

    const employeeIds = filteredProfiles.map((p) => String(p.employeeId)).filter(Boolean)
    const empIdQuery = buildEmployeeIdInQuery(employeeIds)

    // balances: all approved history
    const approvedAll = await LeaveRequest.find({
      employeeId: empIdQuery,
      status: 'APPROVED',
    }).sort({ startDate: 1 }).lean()

    // pending reservations
    const pendingAll = await LeaveRequest.find({
      employeeId: empIdQuery,
      status: { $in: ['PENDING_MANAGER', 'PENDING_GM'] },
    }).sort({ startDate: 1 }).lean()

    // request summary docs (all statuses, later we filter by date range)
    let reqSummaryDocs = await LeaveRequest.find({ employeeId: empIdQuery })
      .sort({ createdAt: -1 })
      .lean()

    if (dateFrom && dateTo) {
      reqSummaryDocs = reqSummaryDocs.filter((d) =>
        overlapsRange(d.startDate, d.endDate, dateFrom, dateTo)
      )
    }

    // replace day docs
    let replaceDocs = await ReplaceDayRequest.find({ employeeId: empIdQuery })
      .sort({ createdAt: -1 })
      .lean()

    if (dateFrom && dateTo) {
      replaceDocs = replaceDocs.filter((d) => {
        const rd = toYMD(d.requestDate || d.createdAt)
        return rd ? (rd >= dateFrom && rd <= dateTo) : false
      })
    }

    // group by employee (normalize request employeeId -> string)
    const approvedByEmp = new Map()
    for (const r of approvedAll || []) {
      const id = String(r.employeeId || '').trim()
      if (!approvedByEmp.has(id)) approvedByEmp.set(id, [])
      approvedByEmp.get(id).push(r)
    }

    const pendingByEmp = new Map()
    for (const r of pendingAll || []) {
      const id = String(r.employeeId || '').trim()
      if (!pendingByEmp.has(id)) pendingByEmp.set(id, [])
      pendingByEmp.get(id).push(r)
    }

    // per-employee rows
    const employeeRows = []
    const totalsMap = new Map()
    for (const code of TYPE_ORDER) {
      totalsMap.set(code, {
        leaveTypeCode: code,
        entitlement: 0,
        used: 0,
        remaining: 0,
        strictRemaining: 0,
      })
    }

    for (const p of filteredProfiles) {
      const empId = String(p.employeeId || '').trim()

      // ✅ support old numeric employeeId stored in requests
      const approved = approvedByEmp.get(empId) || approvedByEmp.get(String(Number(empId))) || []
      const pending = pendingByEmp.get(empId) || pendingByEmp.get(String(Number(empId))) || []

      const snap = computeBalances(p, approved, asOfDate)

      // ✅ support meta.contractYear OR meta.joinYear (depends on your computeBalances)
      const metaWindow = snap?.meta?.contractYear || snap?.meta?.joinYear || null

      const pend = computePendingUsage(pending, metaWindow)
      const strict = computeStrictRemaining(snap, pend)

      const balMap = new Map((snap?.balances || []).map((b) => [String(b.leaveTypeCode || '').toUpperCase(), b]))
      const balances = TYPE_ORDER.map((code) => {
        const b = balMap.get(code) || { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 }
        return {
          leaveTypeCode: code,
          yearlyEntitlement: num(b.yearlyEntitlement),
          used: num(b.used),
          remaining: num(b.remaining),
          strictRemaining: num(strict[code]),
        }
      })

      for (const b of balances) {
        if (!totalsMap.has(b.leaveTypeCode)) {
          totalsMap.set(b.leaveTypeCode, {
            leaveTypeCode: b.leaveTypeCode,
            entitlement: 0,
            used: 0,
            remaining: 0,
            strictRemaining: 0,
          })
        }
        const t = totalsMap.get(b.leaveTypeCode)
        t.entitlement += num(b.yearlyEntitlement)
        t.used += num(b.used)
        t.remaining += num(b.remaining)
        t.strictRemaining += num(b.strictRemaining)
      }

      employeeRows.push({
        employeeId: empId,
        name: p.name || '',
        department: p.department || '',
        joinDate: p.joinDate || null,
        contractDate: p.contractDate || null,
        managerLoginId: p.managerLoginId || '',
        gmLoginId: p.gmLoginId || '',
        isActive: p.isActive !== false,
        alCarry: num(p.alCarry),
        balancesAsOf: asOf,
        balances,
        meta: snap?.meta || {},
        pendingUsage: pend,
      })
    }

    const totalsByType = Array.from(totalsMap.values()).sort(
      (a, b) => TYPE_ORDER.indexOf(a.leaveTypeCode) - TYPE_ORDER.indexOf(b.leaveTypeCode)
    )

    // ───────── LeaveRequest stats ─────────
    const reqCountsByStatus = {}
    const reqCountsByType = {}
    const reqDaysByType = {}
    const reqByMonth = {}

    for (const r of reqSummaryDocs || []) {
      const st = String(r.status || '—')
      const code = String(r.leaveTypeCode || '—').toUpperCase()

      reqCountsByStatus[st] = (reqCountsByStatus[st] || 0) + 1
      reqCountsByType[code] = (reqCountsByType[code] || 0) + 1
      reqDaysByType[code] = (reqDaysByType[code] || 0) + num(r.totalDays)

      const mk = monthKey(r.startDate || r.createdAt)
      if (!reqByMonth[mk]) reqByMonth[mk] = { count: 0, days: 0 }
      reqByMonth[mk].count += 1
      reqByMonth[mk].days += num(r.totalDays)
    }

    // ───────── ReplaceDay stats ─────────
    const repCountsByStatus = {}
    const repByMonth = {}
    let repEvidenceFiles = 0

    for (const r of replaceDocs || []) {
      const st = String(r.status || '—')
      repCountsByStatus[st] = (repCountsByStatus[st] || 0) + 1

      repEvidenceFiles += Array.isArray(r.evidences) ? r.evidences.length : 0

      const mk = monthKey(r.requestDate || r.createdAt)
      if (!repByMonth[mk]) repByMonth[mk] = { count: 0 }
      repByMonth[mk].count += 1
    }

    // recent activity
    const recentLeaveRequests = (reqSummaryDocs || []).slice(0, limit).map((r) => ({
      _id: String(r._id || ''),
      employeeId: String(r.employeeId || '').trim(),
      leaveTypeCode: String(r.leaveTypeCode || '').toUpperCase(),
      startDate: toYMD(r.startDate),
      endDate: toYMD(r.endDate),
      totalDays: num(r.totalDays),
      status: String(r.status || ''),
      createdAt: r.createdAt || null,
      managerLoginId: String(r.managerLoginId || ''),
      gmLoginId: String(r.gmLoginId || ''),
    }))

    const recentReplaceDays = (replaceDocs || []).slice(0, limit).map((r) => ({
      _id: String(r._id || ''),
      employeeId: String(r.employeeId || '').trim(),
      requestDate: toYMD(r.requestDate),
      compensatoryDate: toYMD(r.compensatoryDate),
      status: String(r.status || ''),
      createdAt: r.createdAt || null,
      evidenceCount: Array.isArray(r.evidences) ? r.evidences.length : 0,
      managerLoginId: String(r.managerLoginId || ''),
      gmLoginId: String(r.gmLoginId || ''),
    }))

    const counts = {
      profiles: employeeRows.length,
      active: employeeRows.filter((x) => x.isActive).length,
      inactive: employeeRows.filter((x) => !x.isActive).length,
      leaveRequests: (reqSummaryDocs || []).length,
      replaceDays: (replaceDocs || []).length,
      replaceEvidenceFiles: repEvidenceFiles,
    }

    return res.json({
      meta: {
        asOf,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        typeOrder: TYPE_ORDER,
        counts,
      },

      totalsByType,
      employees: employeeRows,

      leaveRequests: {
        countsByStatus: reqCountsByStatus,
        countsByType: reqCountsByType,
        daysByType: reqDaysByType,
        byMonth: reqByMonth,
        recent: recentLeaveRequests,
      },

      replaceDays: {
        countsByStatus: repCountsByStatus,
        byMonth: repByMonth,
        evidenceFiles: repEvidenceFiles,
        recent: recentReplaceDays,
      },
    })
  } catch (e) {
    console.error('getLeaveReportSummary error', e)
    return res.status(500).json({ message: e.message || 'Failed to load report' })
  }
}
