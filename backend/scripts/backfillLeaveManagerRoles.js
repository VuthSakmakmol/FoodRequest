/* eslint-disable no-console */
require('dotenv').config()

const mongoose = require('mongoose')
const LeaveProfile = require('../models/leave/LeaveProfile')
const User = require('../models/User')

function s(v) {
  return String(v ?? '').trim()
}

async function ensureUserHasRoles(loginId, roles = []) {
  const id = s(loginId)
  if (!id) return null

  const user = await User.findOne({
    $or: [{ loginId: id }, { employeeId: id }],
  })

  if (!user) {
    console.warn(`[skip] user not found for loginId/employeeId: ${id}`)
    return null
  }

  const existing = Array.isArray(user.roles) ? user.roles.map(s).filter(Boolean) : []
  const merged = [...new Set([...existing, ...roles.map(s).filter(Boolean)])]

  let changed = false
  if (merged.length !== existing.length) changed = true
  else {
    for (let i = 0; i < merged.length; i += 1) {
      if (!existing.includes(merged[i])) {
        changed = true
        break
      }
    }
  }

  if (!changed) {
    return { user, changed: false }
  }

  user.roles = merged
  await user.save()

  return { user, changed: true }
}

async function main() {
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(mongoUri)
  console.log('[start] connected to mongo')

  const profiles = await LeaveProfile.find({}, {
    employeeId: 1,
    employeeLoginId: 1,
    managerLoginId: 1,
  }).lean()

  console.log(`[info] profiles found: ${profiles.length}`)

  const managerRefs = new Set()
  for (const p of profiles) {
    const managerLoginId = s(p.managerLoginId)
    if (managerLoginId) managerRefs.add(managerLoginId)
  }

  console.log(`[info] unique manager references: ${managerRefs.size}`)

  let checked = 0
  let updated = 0
  let skipped = 0

  for (const profile of profiles) {
    const employeeId = s(profile.employeeId)
    const employeeLoginId = s(profile.employeeLoginId || employeeId)

    const candidates = [...new Set([employeeId, employeeLoginId].filter(Boolean))]
    const isManager = candidates.some(v => managerRefs.has(v))

    if (!isManager) {
      skipped += 1
      continue
    }

    checked += 1

    const result = await ensureUserHasRoles(employeeLoginId, ['LEAVE_USER', 'LEAVE_MANAGER'])

    if (!result) {
      console.warn(`[warn] no user account matched for profile employeeId=${employeeId}, employeeLoginId=${employeeLoginId}`)
      continue
    }

    if (result.changed) {
      updated += 1
      console.log(`[updated] ${employeeLoginId} -> ${result.user.roles.join(', ')}`)
    } else {
      console.log(`[ok] ${employeeLoginId} already has correct roles`)
    }
  }

  console.log('----------------------------------------')
  console.log(`[done] manager profiles checked: ${checked}`)
  console.log(`[done] updated users: ${updated}`)
  console.log(`[done] skipped non-managers: ${skipped}`)
  console.log('----------------------------------------')

  await mongoose.disconnect()
  console.log('[end] disconnected')
}

main().catch(async (err) => {
  console.error('[error]', err)
  try {
    await mongoose.disconnect()
  } catch (_) {}
  process.exit(1)
})