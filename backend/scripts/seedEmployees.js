// scripts/seedEmployees.js
const mongoose = require('mongoose')
require('dotenv').config()
const EmployeeDirectory = require('../models/EmployeeDirectory')

const MONGO_URI = process.env.MONGO_URI

async function seed() {
  await mongoose.connect(MONGO_URI)

  const employee = {
    employeeId: '52520351',
    name: 'Vuth Sakmakmol',
    department: 'HR Department',
    isActive: true
  }

  await EmployeeDirectory.updateOne(
    { employeeId: employee.employeeId },
    { $set: employee },
    { upsert: true }
  )

  console.log('✅ Employee seeded:', employee)
  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('❌ Error seeding employee:', err)
  process.exit(1)
})
