const EmployeeDirectory = require('../models/EmployeeDirectory')

/** GET /public/employees?activeOnly=true&q= */
exports.publicEmployees = async (req, res, next) => {
  try {
    const { q = '', activeOnly } = req.query
    const query = {}
    if (activeOnly === 'true') query.isActive = true
    if (q) {
      query.$or = [
        { employeeId: new RegExp(q, 'i') },
        { name:       new RegExp(q, 'i') }
      ]
    }

    const docs = await EmployeeDirectory.find(query)
      .select('employeeId name department contactNumber isActive')
      .sort({ employeeId: 1 })
      .lean()

    // Frontend expects a plain array here
    res.json(docs)
  } catch (err) { next(err) }
}
