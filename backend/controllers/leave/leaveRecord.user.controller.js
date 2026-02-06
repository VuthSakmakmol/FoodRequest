/* eslint-disable no-console */
// backend/controllers/leave/leaveRecord.user.controller.js

const createError = require('http-errors')
const mongoose = require('mongoose')
const dayjs = require('dayjs')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const EmployeeDirectory = require('../../models/EmployeeDirectory')

const SIGN_BUCKET = process.env.SIGNATURE_BUCKET || 'signatures'

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
  return s(req.user?.loginId || req.user?.id || req.user?.sub || req.user?.employeeId || '')
}

function actorEmployeeId(req) {
  const direct = s(req.user?.employeeId)
  if (direct) return direct
  const idLike = actorLoginId(req)
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

  return 'GM_ONLY'
}

async function loadProfileByEmployeeId(employeeId) {
  const empId = s(employeeId)
  if (!empId) return null
  return LeaveProfile.findOne({ employeeId: empId }).lean()
}

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

  throw createError(403, 'Not allowed to view this employee record.')
}

function isMongoObjectId(v) {
  return /^[a-f0-9]{24}$/i.test(String(v || '').trim())
}

function ymd(v) {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function up(v) {
  return s(v).toUpperCase()
}

/* ───────────────── Signature lookup (flexible) ─────────────────
  We try multiple places:
  - EmployeeDirectory.signatureFileId / signatureGridFsId / signatureFile / signatureId
  - LeaveProfile.signatureFileId (if you saved there)
  - User-like models if exist in mongoose.models
*/

function tryGetAnyModel(name) {
  try {
    return mongoose.models?.[name] || null
  } catch {
    return null
  }
}

function extractFileId(doc) {
  if (!doc) return ''
  return (
    s(doc.fileId) ||
    s(doc.gridFsId) ||
    s(doc.signatureFileId) ||
    s(doc.signatureGridFsId) ||
    s(doc.signatureFile) ||
    s(doc.signatureId) ||
    s(doc.meta?.fileId) ||
    ''
  )
}

/**
 * ✅ GET /api/leave/user/signatures/resolve/:idLike
 * - numeric => try employee signature first
 * - else => try user signature first
 * returns: { url: "/api/leave/user/signatures/content/<fileId>" } OR { url: "" }
 */
exports.resolveSignatureMeta = async (req, res, next) => {
  try {
    const idLike = s(req.params?.idLike)
    if (!idLike) return res.json({ url: '' })

    const looksEmployeeId = /^\d{4,}$/.test(idLike)

    let fileId = ''

    // 1) EmployeeDirectory
    if (looksEmployeeId) {
      const dir = await EmployeeDirectory.findOne({ employeeId: idLike }).lean()
      fileId = extractFileId(dir)
    } else {
      const dir = await EmployeeDirectory.findOne({ loginId: idLike }).lean().catch(() => null)
      fileId = extractFileId(dir)
    }

    // 2) LeaveProfile (fallback)
    if (!fileId && looksEmployeeId) {
      const prof = await LeaveProfile.findOne({ employeeId: idLike }).lean()
      fileId = extractFileId(prof)
    }

    // 3) Optional signature models (if your project has them)
    if (!fileId) {
      const EmployeeSig = tryGetAnyModel('EmployeeSignature') || tryGetAnyModel('SignatureEmployee')
      const UserSig = tryGetAnyModel('UserSignature') || tryGetAnyModel('SignatureUser') || tryGetAnyModel('ApproverSignature')

      if (looksEmployeeId && EmployeeSig) {
        const doc = await EmployeeSig.findOne({ employeeId: idLike }).lean()
        fileId = extractFileId(doc)
      }
      if (!fileId && !looksEmployeeId && UserSig) {
        const doc = await UserSig.findOne({ loginId: idLike }).lean()
        fileId = extractFileId(doc)
      }

      // fallback swap
      if (!fileId && looksEmployeeId && UserSig) {
        const doc = await UserSig.findOne({ loginId: idLike }).lean()
        fileId = extractFileId(doc)
      }
      if (!fileId && !looksEmployeeId && EmployeeSig) {
        const doc = await EmployeeSig.findOne({ employeeId: idLike }).lean()
        fileId = extractFileId(doc)
      }
    }

    if (!fileId) return res.json({ url: '' })

    return res.json({ url: `/api/leave/user/signatures/content/${encodeURIComponent(fileId)}` })
  } catch (e) {
    next(e)
  }
}

/**
 * ✅ GET /api/leave/user/signatures/content/:fileId
 * Streams image from GridFS bucket "signatures" (or SIGNATURE_BUCKET env).
 * Requires auth (route uses requireAuth).
 */
exports.streamSignatureContent = async (req, res, next) => {
  try {
    const fileIdRaw = s(req.params?.fileId)
    if (!fileIdRaw) throw createError(400, 'Missing fileId.')

    const conn = mongoose.connection
    if (!conn?.db) throw createError(500, 'DB not ready.')

    const bucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: SIGN_BUCKET })

    // accept ObjectId or string id
    const fileId = isMongoObjectId(fileIdRaw) ? new mongoose.Types.ObjectId(fileIdRaw) : fileIdRaw

    // try to find file meta to set content-type
    const files = await conn.db.collection(`${SIGN_BUCKET}.files`).find({ _id: fileId }).limit(1).toArray()
    const fileDoc = files?.[0] || null

    res.setHeader('Cache-Control', 'private, max-age=0, no-store')
    res.setHeader('Pragma', 'no-cache')

    if (fileDoc?.contentType) res.setHeader('Content-Type', fileDoc.contentType)
    else res.setHeader('Content-Type', 'image/png')

    const stream = bucket.openDownloadStream(fileId)

    stream.on('error', (err) => {
      console.error('signature stream error', err)
      // do not leak internals
      if (!res.headersSent) res.status(404)
      res.end()
    })

    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

/* ───────────────── Record building ───────────────── */

/**
 * Contract picker:
 * - if contractId is a MongoId: find in profile.contracts by _id
 * - else: fallback to from/to query
 * - else: pick current contract in profile.contracts or latest
 */
function normalizeContracts(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  const mapped = list
    .map((c, i) => {
      const from = ymd(c.startDate || c.contractDate || c.from)
      const to = ymd(c.endDate || c.contractEndDate || c.to)
      const id = s(c.contractId || c._id || c.id || `${from || 'na'}:${to || 'na'}:${i + 1}`)
      const idx = Number(c.contractNo) || Number(c.contractNumber) || (i + 1)
      const isCurrent = !!c.isCurrent
      return { id, idx, from, to, isCurrent }
    })
    .filter((x) => x.from || x.to)

  // infer current if none
  const today = dayjs().format('YYYY-MM-DD')
  if (!mapped.some((x) => x.isCurrent) && mapped.length) {
    for (const c of mapped) {
      if (c.from && (!c.to ? c.from <= today : c.from <= today && today <= c.to)) c.isCurrent = true
    }
    if (!mapped.some((x) => x.isCurrent)) mapped[mapped.length - 1].isCurrent = true
  }

  return mapped
}

function pickContract(profile, { contractId, from, to }) {
  const contracts = normalizeContracts(profile)

  // by contractId
  const cid = s(contractId)
  if (cid) {
    const hit = contracts.find((c) => s(c.id) === cid)
    if (hit) return { contract: hit, contracts, selectedContractId: hit.id }
  }

  // by range
  const f = ymd(from)
  const t = ymd(to)
  if (f || t) {
    const pseudo = { id: `range:${f || 'na'}:${t || 'na'}`, idx: 1, from: f, to: t, isCurrent: false }
    return { contract: pseudo, contracts, selectedContractId: pseudo.id }
  }

  // default current / latest
  const cur = contracts.find((c) => c.isCurrent)
  const def = cur || contracts[contracts.length - 1] || { id: '', idx: 1, from: ymd(profile?.contractDate), to: ymd(profile?.contractEndDate), isCurrent: true }
  return { contract: def, contracts, selectedContractId: def.id }
}

function extractApprovals(reqDoc) {
  // schema-tolerant mapping
  return {
    approvedManagerLoginId:
      s(reqDoc?.approvedManagerLoginId) ||
      s(reqDoc?.managerLoginId) ||
      s(reqDoc?.approvals?.manager?.loginId) ||
      '',
    approvedGMLoginId:
      s(reqDoc?.approvedGMLoginId) ||
      s(reqDoc?.gmLoginId) ||
      s(reqDoc?.approvals?.gm?.loginId) ||
      '',
    approvedCOOLoginId:
      s(reqDoc?.approvedCOOLoginId) ||
      s(reqDoc?.cooLoginId) ||
      s(reqDoc?.approvals?.coo?.loginId) ||
      '',
  }
}

function leaveTypeShort(reqDoc) {
  return up(reqDoc?.leaveTypeCode || reqDoc?.type || reqDoc?.leaveType || '')
}

function calcDays(reqDoc) {
  // you likely already store days; fallback 0
  return num(reqDoc?.days || reqDoc?.totalDays || reqDoc?.deductDays || reqDoc?.day || 0)
}

function requestStatus(reqDoc) {
  return up(reqDoc?.status || reqDoc?.approvalStatus || '')
}

/**
 * ✅ GET /api/leave/user/record?employeeId=...&contractId=...&asOf=...
 * - access controlled by role (self/manager/gm/coo/admin)
 * - returns { meta, rows } compatible with your preview
 */
exports.getMyLeaveRecord = async (req, res, next) => {
  try {
    const roles = getRoles(req)
    const actorLogin = actorLoginId(req)
    const actorEmpId = actorEmployeeId(req)

    const employeeId = s(req.query?.employeeId) || actorEmpId
    if (!employeeId) throw createError(400, 'Missing employeeId.')

    const profile = await loadProfileByEmployeeId(employeeId)
    if (!profile) throw createError(404, 'Leave profile not found.')

    // ✅ enforce staff visibility rules
    assertCanViewEmployee({ roles, actorLogin, actorEmpId, targetEmpId: employeeId, profile })

    const { contract, contracts, selectedContractId } = pickContract(profile, {
      contractId: req.query?.contractId,
      from: req.query?.from,
      to: req.query?.to,
    })

    // ✅ asOf default = contract.to (never hide rows)
    const asOf = ymd(req.query?.asOf) || ymd(contract?.to) || dayjs().format('YYYY-MM-DD')

    // build range
    const fromYMD = ymd(contract?.from) || ''
    const toYMD = ymd(contract?.to) || asOf

    // Pull requests (schema-tolerant date fields)
    const q = {
      employeeId: employeeId,
      // not filtering by asOf in a way that hides rows; we only bound by contract range if available
    }

    // If you store request date range as startDate/endDate:
    if (fromYMD && toYMD) {
      q.$or = [
        { startDate: { $gte: fromYMD, $lte: toYMD } },
        { from: { $gte: fromYMD, $lte: toYMD } },
        { createdAt: { $gte: new Date(fromYMD), $lte: new Date(toYMD + 'T23:59:59.999Z') } },
      ]
    }

    const reqs = await LeaveRequest.find(q).sort({ createdAt: 1 }).lean()

    // rows (simple + consistent with your table)
    const rows = reqs.map((r) => {
      const from = ymd(r.startDate || r.from || r.dateFrom || r.leaveFrom)
      const to = ymd(r.endDate || r.to || r.dateTo || r.leaveTo)
      const lt = leaveTypeShort(r)
      const days = calcDays(r)
      const st = requestStatus(r)
      const approvals = extractApprovals(r)

      // NOTE: remaining values are best from your existing report logic.
      // Here we keep fields but allow 0 if not stored in request.
      const alDay = lt === 'AL' ? days : ''
      const ulDay = lt === 'UL' ? days : ''
      const slDay = lt === 'SL' || lt === 'SP' || lt === 'MC' ? days : '' // adjust if you want
      const mlDay = lt === 'MA' ? days : ''

      return {
        date: ymd(r.createdAt || r.date || from) || '',
        from: from || '',
        to: to || '',
        leaveTypeCode: lt,
        status: st,
        remark: s(r.remark || r.reason || ''),
        recordByLoginId: s(r.createdByLoginId || r.requesterLoginId || profile?.loginId || employeeId),
        approvedManagerLoginId: approvals.approvedManagerLoginId,
        approvedGMLoginId: approvals.approvedGMLoginId,
        approvedCOOLoginId: approvals.approvedCOOLoginId,

        // fields used by your printed template
        AL_day: alDay,
        AL_remain: num(r.AL_remain ?? r.alRemain ?? r.remainingAL ?? ''),
        UL_day: ulDay,
        SL_day: slDay,
        ML_day: mlDay,
      }
    })

    // EmployeeDirectory enrichment (optional)
    let directory = null
    try {
      directory = await EmployeeDirectory.findOne({ employeeId }).lean()
    } catch {}

    res.json({
      meta: {
        employeeId: s(profile.employeeId),
        name: s(profile.name || directory?.name),
        department: s(profile.department || directory?.department),
        section: s(profile.section || directory?.section || 'Foreigner'),
        joinDate: ymd(profile.joinDate || directory?.joinDate),
        contract: { from: fromYMD, to: toYMD },
        approvalMode: pickApprovalModeSemantic(profile),
        contracts: contracts.map((c) => ({
          contractId: c.id,
          contractNo: c.idx,
          startDate: c.from,
          endDate: c.to,
          isCurrent: !!c.isCurrent,
          label: `Contract ${c.idx}${c.from ? `: ${c.from}` : ''}${c.to ? ` → ${c.to}` : ''}`,
        })),
        selectedContractId,
        typeOrder: ['AL', 'SP', 'MC', 'MA', 'UL'],
      },
      rows,
    })
  } catch (e) {
    next(e)
  }
}
