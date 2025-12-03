// backend/controllers/leave/leaveRequest.controller.js
const LeaveRequest  = require('../../models/leave/LeaveRequest')
const LeaveType     = require('../../models/leave/LeaveType')
const LeaveProfile  = require('../../models/leave/LeaveProfile')
const { enumerateLocalDates } = require('../../utils/datetime')
const { notifyNewLeaveToManager } = require('../../services/leave/leave.telegram.notify')

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Phnom_Penh'


// apply approved leave usage into LeaveProfile.balances
async function applyApprovedLeaveToProfile(reqDoc) {
  const days = Number(reqDoc.totalDays || 0)
  if (!days) return

  const employeeId    = String(reqDoc.employeeId || '').trim()
  const leaveTypeCode = String(reqDoc.leaveTypeCode || '').trim().toUpperCase()

  if (!employeeId || !leaveTypeCode) return

  // find leave type + profile
  const type = await LeaveType.findOne({ code: leaveTypeCode }).lean()
  if (!type) return

  const profile = await LeaveProfile.findOne({ employeeId })
  if (!profile) return

  // find / create balance row for this type
  let bal = (profile.balances || []).find(
    b => String(b.leaveTypeCode).toUpperCase() === leaveTypeCode
  )

  if (!bal) {
    bal = {
      leaveTypeCode,
      yearlyEntitlement: Number(type.yearlyEntitlement || 0),
      used: 0,
      remaining: Number(type.yearlyEntitlement || 0),
    }
    profile.balances.push(bal)
  }

  // If this type does not require balance (UL), just track used
  if (!type.requiresBalance) {
    bal.used = Number(bal.used || 0) + days
  } else {
    const allowNegative = !!type.allowNegative
    const currentRem    = Number(bal.remaining || 0)

    if (!allowNegative && currentRem < days) {
      // safety net – in theory we already validated before approval
      throw new Error(
        `Insufficient balance for ${leaveTypeCode}. Remaining ${currentRem}, requested ${days}`
      )
    }

    bal.used      = Number(bal.used || 0) + days
    bal.remaining = currentRem - days

    if (!allowNegative && bal.remaining < 0) {
      bal.remaining = 0
    }
  }

  profile.markModified('balances')
  await profile.save()
}


/**
 * POST /api/leave/requests
 * Body: { leaveTypeCode, startDate, endDate, reason }
 * Creates a new request for the logged-in user (expat).
 */
exports.createMyRequest = async (req, res, next) => {
  try {
    const { leaveTypeCode, startDate, endDate, reason = '' } = req.body || {}

    // loginId from JWT = req.user.id (see signToken in auth.controller.js)
    const requesterLoginId = String(req.user?.id || '').trim()
    if (!requesterLoginId) {
      return res.status(400).json({ message: 'Missing requester identity' })
    }

    // For now we assume: expat loginId == employeeId (employee code)
    const employeeId = requesterLoginId

    if (!leaveTypeCode || !startDate || !endDate) {
      return res.status(400).json({
        message: 'leaveTypeCode, startDate, and endDate are required',
      })
    }

    // Ensure leave type exists & active
    const lt = await LeaveType.findOne({
      code: String(leaveTypeCode).trim().toUpperCase(),
      isActive: true,
    }).lean()

    if (!lt) {
      return res.status(400).json({ message: 'Invalid or inactive leave type' })
    }

    // Look up LeaveProfile → who is manager / GM for this expat
    const profile = await LeaveProfile.findOne({
      employeeId,
      isActive: true,
    }).lean()

    if (!profile) {
      return res.status(400).json({
        message: 'Leave profile is not configured for this employee. Please contact HR/admin.',
      })
    }

    const managerLoginId = String(profile.managerLoginId || '').trim()
    const gmLoginId      = String(profile.gmLoginId || '').trim()

    if (!managerLoginId || !gmLoginId) {
      return res.status(400).json({
        message: 'Manager/GM mapping is incomplete for this employee. Please contact HR/admin.',
      })
    }

    // Calculate days inclusive using helper (no weekend/holiday logic yet)
    const dates = enumerateLocalDates(startDate, endDate, DEFAULT_TZ)
    const totalDays = dates.length

    if (!totalDays || totalDays <= 0) {
      return res.status(400).json({ message: 'Invalid date range' })
    }

    const doc = await LeaveRequest.create({
      employeeId,
      requesterLoginId,
      leaveTypeCode: lt.code,
      startDate,
      endDate,
      totalDays,
      reason,
      status: 'PENDING_MANAGER',
      managerLoginId,
      gmLoginId,
    })

    // 🔔 Telegram DM to manager (if chatId available)
    try {
      await notifyNewLeaveToManager(doc)
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ notifyNewLeaveToManager failed:', e?.message)
      }
    }

    // TODO (later): emit socket event

    res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/requests/my
 * Returns leave requests for the logged-in user (by employeeId / loginId).
 */
exports.listMyRequests = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const employeeId = loginId

    const docs = await LeaveRequest.find({ employeeId })
      .sort({ createdAt: -1 })
      .lean()

    res.json(docs)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/requests/manager/inbox
 * Manager sees requests waiting for them
 */
exports.listManagerInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const docs = await LeaveRequest.find({
      managerLoginId: loginId,
      status: 'PENDING_MANAGER',
    })
      .sort({ createdAt: -1 })
      .lean()

    res.json(docs)
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/leave/requests/:id/manager-decision
 * Body: { action: 'APPROVE' | 'REJECT', comment? }
 */
exports.managerDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (doc.managerLoginId !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (doc.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'Request not in manager queue' })
    }

    if (action === 'APPROVE') {
      doc.status = 'PENDING_GM'
    } else if (action === 'REJECT') {
      doc.status = 'REJECTED'
    } else {
      return res.status(400).json({ message: 'Invalid action' })
    }

    doc.managerComment    = String(comment || '')
    doc.managerDecisionAt = new Date()

    await doc.save()

    // TODO: notify GM or employee via telegram

    res.json(doc)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/leave/requests/gm/inbox
 * GM sees requests waiting for GM approval
 */
exports.listGmInbox = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const docs = await LeaveRequest.find({
      gmLoginId: loginId,
      status: 'PENDING_GM',
    })
      .sort({ createdAt: -1 })
      .lean()

    res.json(docs)
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/leave/requests/:id/gm-decision
 * Body: { action: 'APPROVE' | 'REJECT', comment? }
 */
exports.gmDecision = async (req, res, next) => {
  try {
    const loginId = String(req.user?.id || '').trim()
    if (!loginId) {
      return res.status(400).json({ message: 'Missing user identity' })
    }

    const { id } = req.params
    const { action, comment = '' } = req.body || {}

    const doc = await LeaveRequest.findById(id)
    if (!doc) return res.status(404).json({ message: 'Request not found' })

    if (doc.gmLoginId !== loginId) {
      return res.status(403).json({ message: 'Not your request' })
    }

    if (doc.status !== 'PENDING_GM') {
      return res.status(400).json({ message: 'Request not in GM queue' })
    }

    if (action === 'APPROVE') {
      doc.status = 'APPROVED'
    } else if (action === 'REJECT') {
      doc.status = 'REJECTED'
    } else {
      return res.status(400).json({ message: 'Invalid action' })
    }

    doc.gmComment    = String(comment || '')
    doc.gmDecisionAt = new Date()

    await doc.save()

    // ✅ Only when APPROVED we apply usage into profile
    if (doc.status === 'APPROVED') {
      try {
        await applyApprovedLeaveToProfile(doc)
      } catch (applyErr) {
        console.error('applyApprovedLeaveToProfile error:', applyErr)
        // we still return success; you can change to res.status(500) if you want it strict
      }
    }

    res.json(doc)
  } catch (err) {
    next(err)
  }
}
