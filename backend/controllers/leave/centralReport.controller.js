/* eslint-disable no-console */
const createError = require('http-errors')
const svc = require('../../services/leave/centralReport.service')

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function num(v, def = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}
function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

exports.getCentralReport = async (req, res, next) => {
  try {
    // ✅ parse filters
    const search = s(req.query.search)
    const module = up(req.query.module || 'ALL') // ALL | LEAVE | FORGET_SCAN | SWAP_DAY
    const status = up(req.query.status || 'ALL') // ALL | PENDING_MANAGER | ... | APPROVED
    const approvalMode = up(req.query.approvalMode || 'ALL') // ALL | MANAGER_AND_GM | ...

    const from = s(req.query.from)
    const to = s(req.query.to)

    if (from && !isValidYMD(from)) throw createError(400, 'from must be YYYY-MM-DD')
    if (to && !isValidYMD(to)) throw createError(400, 'to must be YYYY-MM-DD')

    const limit = Math.min(Math.max(num(req.query.limit, 50), 1), 500)
    const skip = Math.max(num(req.query.skip, 0), 0)

    // ✅ call service
    const result = await svc.getCentralReport({
      search,
      module,
      status,
      approvalMode,
      from: from || '',
      to: to || '',
      limit,
      skip,
    })

    return res.json(result)
  } catch (e) {
    next(e)
  }
}