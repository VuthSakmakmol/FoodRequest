/* eslint-disable no-console */
// backend/controllers/leave/leaveRecord.admin.controller.js
//
// ✅ Admin-only employee leave record for PDF/Excel
// ✅ Works with ONLY 3 approval modes (semantic):
//    - MANAGER_AND_GM
//    - MANAGER_AND_COO
//    - GM_AND_COO
//
// ✅ Signature logic by mode + status:
//    - recordByEmployeeId: ALWAYS employeeId
//    - checkedByLoginId:  ALWAYS "leave_admin" (system signature)
//    - approvedManagerLoginId: shown after manager approved (when mode includes manager)
//    - approvedGMLoginId:      shown after GM approved (when mode includes gm)
//    - approvedCOOLoginId:     shown only after final APPROVED (when mode includes coo)

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

function up(v) {
  return safeText(v).toUpperCase()
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
  const [y, m, d] = s.split('-').map(Number)
  const utcMidnight = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0)
  const ppMidnightUtc = utcMidnight - PP_OFFSET_MINUTES * 60 * 1000
  return new Date(ppMidnightUtc)
}

function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => up(x)).filter(Boolean))].filter(Boolean)
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
  const c = up(systemCode)
  if (c === 'MC') return 'SL'
  if (c === 'MA') return 'ML'
  // ✅ BL stays BL (explicit)
  if (c === 'BL') return 'BL'
  return c
}

/** ✅ Add BL_day support */
function dayColsForPdf(pdfCode, totalDays) {
  const d = num(totalDays)
  return {
    UL_day: pdfCode === 'UL' ? d : '',
    SL_day: pdfCode === 'SL' ? d : '',
    ML_day: pdfCode === 'ML' ? d : '',
    BL_day: pdfCode === 'BL' ? d : '', // ✅ NEW
  }
}

// ───────── Contract helpers ─────────

function pickContract(profile, { contractId, contractNo }) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  if (!list.length) return null

  if (contractId) return list.find((c) => String(c._id) === String(contractId)) || null
  if (contractNo) return list.find((c) => Number(c.contractNo) === Number(contractNo)) || null
  return null
}

function getCurrentContract(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  if (!list.length) return null
  const open = list.filter((c) => !c.closedAt)
  return (open.length ? open : list).sort((a, b) => Number(a.contractNo) - Number(b.contractNo)).pop()
}

function contractMeta(contract) {
  if (!contract) return null
  return {
    contractId: String(contract._id),
    contractNo: contract.contractNo,
    startDate: contract.startDate,
    endDate: contract.endDate,
    closedAt: contract.closedAt || null,
    closeSnapshotAsOf: safeText(contract.closeSnapshot?.asOf || ''),
  }
}

function listContractsMeta(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  const current = getCurrentContract(profile)
  return list.map((c) => ({
    contractId: String(c._id),
    contractNo: c.contractNo,
    startDate: c.startDate,
    endDate: c.endDate,
    closedAt: c.closedAt || null,
    isCurrent: current && String(current._id) === String(c._id),
    label: `Contract ${c.contractNo}: ${c.startDate}${c.endDate ? ` → ${c.endDate}` : ''}`,
  }))
}

// ───────── Approval / signature helpers ─────────

function normMode(v) {
  if (typeof LeaveRequest.normalizeMode === 'function') return LeaveRequest.normalizeMode(v)
  const m = up(v)
  if (m === 'MANAGER_AND_COO' || m === 'GM_AND_COO' || m === 'MANAGER_AND_GM') return m
  return 'MANAGER_AND_GM'
}

function modeHasManager(mode) {
  const m = normMode(mode)
  return m === 'MANAGER_AND_GM' || m === 'MANAGER_AND_COO'
}
function modeHasGm(mode) {
  const m = normMode(mode)
  return m === 'MANAGER_AND_GM' || m === 'GM_AND_COO'
}
function modeHasCoo(mode) {
  const m = normMode(mode)
  return m === 'MANAGER_AND_COO' || m === 'GM_AND_COO'
}

function shouldShowManagerSig(mode, status) {
  if (!modeHasManager(mode)) return false
  const st = up(status)
  return st === 'PENDING_GM' || st === 'PENDING_COO' || st === 'APPROVED'
}

function shouldShowGmSig(mode, status) {
  if (!modeHasGm(mode)) return false
  const st = up(status)
  return st === 'PENDING_COO' || st === 'APPROVED'
}

function shouldShowCooSig(mode, status) {
  if (!modeHasCoo(mode)) return false
  const st = up(status)
  return st === 'APPROVED'
}

// ───────────────── controller ─────────────────

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

    const asOf = req.query.asOf ? assertYMD(req.query.asOf, 'asOf') : ''

    const statuses = safeText(req.query.statuses)
      ? safeText(req.query.statuses).split(',').map((x) => up(x))
      : ['APPROVED', 'PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO']

    const contractId = safeText(req.query.contractId)
    const contractNo = safeText(req.query.contractNo)

    const profile =
      (await LeaveProfile.findOne({ employeeId }).lean()) ||
      (await LeaveProfile.findOne({ employeeId: Number(employeeId) }).lean())
    if (!profile) return res.status(404).json({ message: 'Leave profile not found.' })

    const dir = await EmployeeDirectory.findOne(
      { employeeId: buildEmpIdIn(employeeId) },
      { employeeId: 1, name: 1, fullName: 1, department: 1, departmentName: 1, section: 1, joinDate: 1 }
    ).lean()

    const metaName = safeText(dir?.name || dir?.fullName || profile?.name || '')
    const metaDepartment = safeText(dir?.departmentName || dir?.department || profile?.department || '')
    const metaSection = safeText(dir?.section || profile?.section || 'Foreigner')
    const metaJoinDate = toYMD(dir?.joinDate || profile?.joinDate || profile?.meta?.joinDate)

    const checkedByLoginId = safeText(process.env.LEAVE_ADMIN_LOGIN_ID || 'leave_admin')

    const requested = pickContract(profile, { contractId, contractNo })
    const current = getCurrentContract(profile)
    const selectedContract = requested || current
    if (!selectedContract) return res.status(400).json({ message: 'No contract found.' })

    let docs = await LeaveRequest.find({
      employeeId: buildEmpIdIn(employeeId),
      status: { $in: statuses },
    })
      .sort({ startDate: 1, createdAt: 1 })
      .lean()

    docs = docs.filter((r) => overlapsRange(r.startDate, r.endDate, selectedContract.startDate, selectedContract.endDate))
    if (from && to) docs = docs.filter((r) => overlapsRange(r.startDate, r.endDate, from, to))
    if (asOf) docs = docs.filter((r) => toYMD(r.startDate) <= asOf)

    const approved = docs.filter((r) => up(r.status) === 'APPROVED')
    const approvedIndex = new Map(approved.map((r, i) => [String(r._id), i]))

    const rows = []
    for (const r of docs) {
      const sysCode = up(r.leaveTypeCode)
      const st = up(r.status)
      const mode = normMode(r.approvalMode || profile.approvalMode)

      let alRemain = ''
      if (st === 'APPROVED') {
        const idx = approvedIndex.get(String(r._id))
        const hist = idx >= 0 ? approved.slice(0, idx + 1) : approved
        const snap = computeBalances(profile, hist, phnomPenhMidnightDate(toYMD(r.endDate || r.startDate)))
        const al = (snap?.balances || []).find((b) => up(b.leaveTypeCode) === 'AL')
        alRemain = num(al?.remaining)
      }

      const pdfCode = mapToPdfCode(sysCode)

      const mgrId = safeText(r.managerLoginId || profile.managerLoginId || '')
      const gmId = safeText(r.gmLoginId || profile.gmLoginId || '')
      const cooId = safeText(r.cooLoginId || profile.cooLoginId || '')

      rows.push({
        _id: String(r._id || ''),

        date: toYMD(r.createdAt),
        from: toYMD(r.startDate),
        to: toYMD(r.endDate || r.startDate),

        AL_day: sysCode === 'AL' ? num(r.totalDays) : '',
        SP_day: sysCode === 'SP' ? num(r.totalDays) : '',

        // ✅ show AL remaining for BOTH AL and SP (SP borrows AL)
        AL_remain: sysCode === 'AL' || sysCode === 'SP' ? alRemain : '',

        // ✅ UL / SL / ML / BL columns
        ...dayColsForPdf(pdfCode, r.totalDays),

        // ✅ system for template + excel
        leaveTypeCode: pdfCode,
        status: r.status,
        approvalMode: mode,

        recordByEmployeeId: safeText(profile.employeeId),
        checkedByLoginId,

        approvedManagerLoginId: shouldShowManagerSig(mode, st) ? mgrId : '',
        approvedGMLoginId: shouldShowGmSig(mode, st) ? gmId : '',
        approvedCOOLoginId: shouldShowCooSig(mode, st) ? cooId : '',

        remark: safeText(r.reason || r.note || r.remark || ''),
      })
    }

    return res.json({
      meta: {
        employeeId,
        name: metaName,
        department: metaDepartment,
        section: metaSection,
        joinDate: metaJoinDate,

        contract: contractMeta(selectedContract),
        contracts: listContractsMeta(profile),

        asOf: asOf || null,
        generatedAt: nowYMD(),
      },
      rows,
    })
  } catch (e) {
    console.error('getEmployeeLeaveRecord error', e)
    return res.status(500).json({ message: e.message || 'Failed to load employee leave record' })
  }
}