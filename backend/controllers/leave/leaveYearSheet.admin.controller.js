// backend/controllers/leave/leaveYearSheet-admin.controller.js
const LeaveProfile = require('../../models/leave/LeaveProfile')

exports.getYearSheet = async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    // TODO: replace with your real YearSheet model/service
    const prof = await LeaveProfile.findOne({ employeeId }).lean()
    if (!prof) return res.status(404).json({ message: 'Profile not found' })

    return res.json({
      employeeId,
      profile: prof,
      // yearSheet: ...
    })
  } catch (e) {
    console.error('getYearSheet error', e)
    return res.status(500).json({ message: 'Failed to load year sheet' })
  }
}

exports.recomputeYearSheet = async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId || '').trim()
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' })

    // TODO: your recompute logic
    return res.json({ ok: true })
  } catch (e) {
    console.error('recomputeYearSheet error', e)
    return res.status(500).json({ message: 'Failed to recompute year sheet' })
  }
}

exports.exportYearSheetXlsx = async (req, res) => {
  try {
    // TODO: your XLSX export
    return res.status(501).json({ message: 'Not implemented yet' })
  } catch (e) {
    console.error('exportYearSheetXlsx error', e)
    return res.status(500).json({ message: 'Failed to export year sheet' })
  }
}
