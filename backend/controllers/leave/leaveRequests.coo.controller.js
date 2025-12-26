/* eslint-disable no-console */
const LeaveRequest = require('../../models/leave/LeaveRequest')

function getRoles(req) {
  const raw = Array.isArray(req.user?.roles) ? req.user.roles : []
  const base = req.user?.role ? [req.user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase()))]
}
function actorLoginId(req) {
  return String(req.user?.loginId || req.user?.id || req.user?.sub || '').trim()
}

exports.listCooInbox = async (req, res) => {
  try {
    const roles = getRoles(req)
    if (!roles.includes('LEAVE_COO') && !roles.includes('LEAVE_ADMIN') && !roles.includes('ADMIN')) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const me = actorLoginId(req)

    // ✅ Adjust these filters to match your LeaveRequest schema.
    // This version is tolerant so it won’t crash even if fields differ.
    const query = {
      approvalMode: 'GM_AND_COO',
      $or: [
        { cooLoginId: me },
        { cooLoginId: { $exists: false } }, // older docs
        { cooLoginId: '' },
        { cooLoginId: null },
      ],
      status: { $in: ['PENDING_COO', 'GM_APPROVED'] },
    }

    const rows = await LeaveRequest.find(query)
      .sort({ createdAt: -1 })
      .lean()

    return res.json(rows || [])
  } catch (e) {
    console.error('listCooInbox error', e)
    return res.status(500).json({ message: 'Failed to load COO inbox.' })
  }
}
