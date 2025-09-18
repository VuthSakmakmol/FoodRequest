// backend/controllers/employeeDirectory.controller.js

const EmployeeDirectory = require('../models/EmployeeDirectory')

exports.getEmployees = async (req, res, next) => {
  try {
    const query = {}
    if (req.query.activeOnly === 'true') {
      query.isActive = true
    }
    const employees = await EmployeeDirectory.find(query).select('employeeId name department isActive')
    res.json(employees)
  } catch (err) {
    next(err)
  }
}


// (optional) POST to add new employee
exports.createEmployee = async (req, res, next) => {
  try {
    const { employeeId, name, department } = req.body
    if (!employeeId || !name || !department) {
      return res.status(400).json({ message: 'employeeId, name, department required' })
    }
    const exists = await EmployeeDirectory.findOne({ employeeId })
    if (exists) return res.status(409).json({ message: 'Employee already exists' })

    const doc = await EmployeeDirectory.create({ employeeId, name, department })
    res.status(201).json(doc)
  } catch (err) {
    next(err)
  }
}
