/* eslint-disable no-console */
// backend/controllers/leave/leaveRecord.user.controller.js

const mongoose = require('mongoose')

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
function toYMD(v) {
  if (!v) return ''
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    if (isValidYMD(s)) return s
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
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
/** Phnom Penh midnight Date for a YMD (prevents timezone drift). */
function phnomPenhMidnightDate(ymd) {
  const s = String(ymd || '').trim()
  if (!isValidYMD(s)) return new Date()
  const [y, m, d] = s.split('-').map(Number)
  const utcMidnight = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0)
  const ppMidnightUtc = utcMidnight - PP_OFFSET_MINUTES * 60 * 1000
  return new Date(ppMidnightUtc)
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
  if (c === 'MC') return 'SL'
  if (c === 'MA') return 'ML'
  return c
}

/** For PDF columns: AL includes SP (borrow from AL) */
function shouldCountAsAL(systemCode) {
  const c = String(systemCode || '').toUpperCase().trim()
  return c === 'AL' || c === 'SP'
}

function dayColsForPdf(pdfCode, totalDays) {
  const d = num(totalDays)
  return {
    UL_day: pdfCode === 'UL' ? d : '',
    SL_day: pdfCode === 'SL' ? d : '',
    ML_day: pdfCode === 'ML' ? d : '',
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
    balancesAsOf: contract.closeSnapshot?.balancesAsOf || '',
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

/** resolve employeeId from token (best effort) */
async function resolveEmployeeId(req) {
  const direct = safeText(req.user?.employeeId)
  if (direct) return direct

  const loginId = safeText(req.user?.loginId || req.user?.id || req.user?.sub)
  if (!loginId) return ''

  const emp =
    (await EmployeeDirectory.findOne({ loginId }).lean()) ||
    (await EmployeeDirectory.findOne({ employeeId: loginId }).lean())

  return safeText(emp?.employeeId)
}

async function loadDirectoryForEmployee(employeeId) {
  const id = safeText(employeeId)
  if (!id) return null
  return (
    (await EmployeeDirectory.findOne({ employeeId: id }).lean()) ||
    (await EmployeeDirectory.findOne({ employeeId: Number(id) }).lean()) ||
    null
  )
}

// ───────────────── SIGNATURE META RESOLVER (inside same controller file) ─────────────────
//
// This returns only { signatureUrl } so the frontend can fetch the image with JWT.
// Why user couldn’t render before: user token can’t call /admin/signatures/*
//
// ✅ You MUST set these model names to match your project once.
//
const EMPLOYEE_SIG_MODEL = process.env.EMPLOYEE_SIG_MODEL || 'EmployeeSignature'
const APPROVER_SIG_MODEL = process.env.APPROVER_SIG_MODEL || 'ApproverSignature'

function getModelSafe(name) {
  try {
    return mongoose.models?.[name] || null
  } catch {
    return null
  }
}

function isLikelyEmployeeId(v) {
  return /^\d{4,}$/.test(safeText(v))
}

async function findEmployeeSignatureUrl(employeeIdLike) {
  const Model = getModelSafe(EMPLOYEE_SIG_MODEL)
  if (!Model) return ''
  const id = safeText(employeeIdLike)
  if (!id) return ''

  const n = Number(id)
  const doc =
    (await Model.findOne({ employeeId: id }).lean()) ||
    (Number.isFinite(n) ? await Model.findOne({ employeeId: n }).lean() : null)

  return safeText(doc?.signatureUrl || doc?.url || '')
}

async function findApproverSignatureUrl(loginId) {
  const Model = getModelSafe(APPROVER_SIG_MODEL)
  if (!Model) return ''
  const id = safeText(loginId)
  if (!id) return ''
  const doc = await Model.findOne({ loginId: id }).lean()
  return safeText(doc?.signatureUrl || doc?.url || '')
}

// ✅ GET /api/leave/user/signatures/resolve/:idLike
exports.resolveSignatureMeta = async (req, res) => {
  try {
    const idLike = safeText(req.params.idLike)
    if (!idLike) return res.json({ signatureUrl: '' })

    const numericFirst = isLikelyEmployeeId(idLike)

    let url = ''
    if (numericFirst) {
      url = (await findEmployeeSignatureUrl(idLike)) || (await findApproverSignatureUrl(idLike))
    } else {
      url = (await findApproverSignatureUrl(idLike)) || (await findEmployeeSignatureUrl(idLike))
    }

    return res.json({ signatureUrl: url || '' })
  } catch (e) {
    console.error('resolveSignatureMeta error', e)
    return res.status(500).json({ message: e.message || 'Failed to resolve signature meta' })
  }
}

// ───────────────── Leave Record (USER) ─────────────────

// ✅ GET /api/leave/user/record?contractId=...&contractNo=...&from=...&to=...&asOf=...
exports.getMyLeaveRecord = async (req, res) => {
  try {
    const employeeId = await resolveEmployeeId(req)
    if (!employeeId) return res.status(401).json({ message: 'Unauthorized (missing employeeId)' })

    const from = req.query.from ? assertYMD(req.query.from, 'from') : ''
    const to = req.query.to ? assertYMD(req.query.to, 'to') : ''
    if ((from && !to) || (!from && to)) return res.status(400).json({ message: 'from and to must be provided together.' })
    if (from && to && from > to) return res.status(400).json({ message: 'from cannot be after to.' })

    const asOf = req.query.asOf ? assertYMD(req.query.asOf, 'asOf') : ''

    const statuses = safeText(req.query.statuses)
      ? safeText(req.query.statuses)
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : ['APPROVED', 'PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO']

    const contractId = safeText(req.query.contractId)
    const contractNo = safeText(req.query.contractNo)

    const profile =
      (await LeaveProfile.findOne({ employeeId }).lean()) ||
      (await LeaveProfile.findOne({ employeeId: Number(employeeId) }).lean())

    if (!profile) return res.status(404).json({ message: 'Leave profile not found.' })

    const requested = pickContract(profile, { contractId, contractNo })
    const current = getCurrentContract(profile)
    const selectedContract = requested || current
    if (!selectedContract) return res.status(400).json({ message: 'No contract found.' })

    const dir = await loadDirectoryForEmployee(employeeId)
    const name = safeText(dir?.name || dir?.fullName || profile?.name || '')
    const department = safeText(dir?.departmentName || dir?.department || profile?.department || '')
    const section = safeText(dir?.section || 'Foreigner')
    const joinDate = toYMD(profile?.joinDate || '')

    let docs = await LeaveRequest.find({
      employeeId: buildEmpIdIn(employeeId),
      status: { $in: statuses },
    })
      .sort({ startDate: 1, createdAt: 1 })
      .lean()

    // ✅ always clamp to selected contract range
    docs = docs.filter((r) =>
      overlapsRange(r.startDate, r.endDate, selectedContract.startDate, selectedContract.endDate)
    )

    // optional extra range
    if (from && to) docs = docs.filter((r) => overlapsRange(r.startDate, r.endDate, from, to))

    // optional asOf
    if (asOf) docs = docs.filter((r) => toYMD(r.startDate) <= asOf)

    // compute AL remaining only for approved AL/SP rows
    const approved = docs.filter((r) => safeText(r.status).toUpperCase() === 'APPROVED')
    const approvedIndex = new Map(approved.map((r, i) => [String(r._id), i]))

    const rows = []
    for (const r of docs) {
      const st = safeText(r.status).toUpperCase()
      const pdfCode = mapToPdfCode(r.leaveTypeCode)

      let alRemain = ''
      if (st === 'APPROVED' && shouldCountAsAL(r.leaveTypeCode)) {
        const idx = approvedIndex.get(String(r._id))
        const hist = idx >= 0 ? approved.slice(0, idx + 1) : approved

        const snapDate = phnomPenhMidnightDate(toYMD(r.endDate || r.startDate) || nowYMD())
        const snap = computeBalances(profile, hist, snapDate)

        const al = (snap?.balances || []).find((b) => String(b.leaveTypeCode || '').toUpperCase() === 'AL')
        alRemain = num(al?.remaining)
      }

      rows.push({
        _id: String(r._id || ''),

        date: toYMD(r.createdAt),
        from: toYMD(r.startDate),
        to: toYMD(r.endDate || r.startDate),

        AL_day: shouldCountAsAL(r.leaveTypeCode) ? num(r.totalDays) : '',
        AL_remain: shouldCountAsAL(r.leaveTypeCode) ? alRemain : '',

        ...dayColsForPdf(pdfCode, r.totalDays),

        leaveTypeCode: pdfCode,
        status: r.status,

        // ✅ IMPORTANT: these IDs are what the frontend uses to resolve signature meta
        recordByLoginId: safeText(profile.employeeId || employeeId), // employee signature id
        approvedManagerLoginId: st === 'PENDING_GM' || st === 'APPROVED' ? safeText(profile.managerLoginId) : '',
        approvedGMLoginId: st === 'APPROVED' ? safeText(profile.gmLoginId) : '',

        remark: safeText(r.reason || r.note || r.remark || ''),
      })
    }

    return res.json({
      meta: {
        employeeId,
        name,
        department,
        section,
        joinDate,

        // ✅ helpful for user UI signature lookup
        managerLoginId: safeText(profile.managerLoginId),
        gmLoginId: safeText(profile.gmLoginId),

        contract: contractMeta(selectedContract),
        contracts: listContractsMeta(profile),
        asOf: asOf || null,
      },
      rows,
    })
  } catch (e) {
    console.error('getMyLeaveRecord error', e)
    return res.status(500).json({ message: e.message || 'Failed to load my leave record' })
  }
}
