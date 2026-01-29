/* eslint-disable no-console */
// backend/controllers/leave/leaveRecord.admin.controller.js
const createError = require('http-errors')
const dayjs = require('dayjs')

const LeaveProfile = require('../../models/leave/LeaveProfile')
const LeaveRequest = require('../../models/leave/LeaveRequest')
const ReplaceDayRequest = require('../../models/leave/ReplaceDayRequest')

function safeId(v) {
  return String(v || '').trim()
}

function parseYMD(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const d = dayjs(s, 'YYYY-MM-DD', true)
  return d.isValid() ? d : null
}

function normalizeReq(r) {
  const type = String(r.type || r.leaveType || r.leaveCode || '').trim().toUpperCase()
  const status = String(r.status || '').trim().toUpperCase()
  const employeeId = String(r.employeeId || r.employeeID || r.empId || r.employee || '').trim()
  const start = r.startDate || r.start || r.fromDate || r.from || r.dateFrom || null
  const end = r.endDate || r.end || r.toDate || r.to || r.dateTo || null

  const startDate = start ? dayjs(String(start).slice(0, 10)) : null
  const endDate = end ? dayjs(String(end).slice(0, 10)) : null

  const days = Number(r.days ?? r.totalDays ?? r.deductDays ?? r.duration ?? 0) || 0

  return {
    _id: String(r._id),
    requestId: String(r.requestId || ''),
    employeeId,
    type,
    status,
    startDate: startDate?.isValid() ? startDate.format('YYYY-MM-DD') : '',
    endDate: endDate?.isValid() ? endDate.format('YYYY-MM-DD') : '',
    days,
    reason: String(r.reason || r.remark || r.note || '').trim(),
    createdAt: r.createdAt ? dayjs(r.createdAt).toISOString() : null,
  }
}

/**
 * GET /admin/leave/reports/employee/:employeeId/record?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns:
 * - profile
 * - leave requests (filtered by range if provided)
 * - replace day requests (same)
 */
exports.getEmployeeLeaveRecord = async (req, res) => {
  const employeeId = safeId(req.params.employeeId)
  if (!employeeId) throw createError(400, 'employeeId is required.')

  const fromQ = parseYMD(req.query.from)
  const toQ = parseYMD(req.query.to)

  const from = fromQ || dayjs().startOf('year')
  const to = toQ || dayjs().endOf('year')
  if (!from.isValid() || !to.isValid()) throw createError(400, 'Invalid from/to date.')
  if (to.isBefore(from)) throw createError(400, '"to" must be after "from".')

  const profile = await LeaveProfile.findOne({ employeeId }).lean()
  if (!profile) throw createError(404, `LeaveProfile not found for employeeId ${employeeId}`)

  // overlap match for leave requests (try common schema)
  const matchReq = {
    $and: [
      { $or: [{ employeeId }, { employeeID: employeeId }, { empId: employeeId }] },
      {
        $or: [
          {
            $and: [
              { startDate: { $lte: to.format('YYYY-MM-DD') } },
              { endDate: { $gte: from.format('YYYY-MM-DD') } },
            ],
          },
          {
            $and: [
              { fromDate: { $lte: to.format('YYYY-MM-DD') } },
              { toDate: { $gte: from.format('YYYY-MM-DD') } },
            ],
          },
          {},
        ],
      },
    ],
  }

  const reqs = await LeaveRequest.find(matchReq)
    .sort({ createdAt: -1 })
    .select(
      '_id requestId employeeId employeeID empId employee type leaveType leaveCode status startDate endDate fromDate toDate days totalDays deductDays duration reason remark note createdAt'
    )
    .lean()

  // replace day requests (optional)
  const matchRD = {
    $and: [
      { $or: [{ employeeId }, { employeeID: employeeId }, { empId: employeeId }] },
      {
        $or: [
          // common: requestDate
          { requestDate: { $gte: from.format('YYYY-MM-DD'), $lte: to.format('YYYY-MM-DD') } },
          // alternate: date
          { date: { $gte: from.format('YYYY-MM-DD'), $lte: to.format('YYYY-MM-DD') } },
          {},
        ],
      },
    ],
  }

  const replaceDays = await ReplaceDayRequest.find(matchRD)
    .sort({ createdAt: -1 })
    .lean()

  res.json({
    range: { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') },
    employeeId,
    profile,
    requests: reqs.map(normalizeReq),
    replaceDayRequests: replaceDays,
  })
}
