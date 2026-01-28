// backend/utils/signature.js
const fs = require('fs')
const path = require('path')

function uploadRoot() {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads')
}

function pickExisting(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return null
}

function publicUrlFromAbs(absPath) {
  const rel = path.relative(uploadRoot(), absPath).split(path.sep).join('/')
  return `/uploads/${rel}`
}

function userSignatureUrl(loginId) {
  const id = String(loginId || '').trim()
  if (!id) return ''
  const base = path.join(uploadRoot(), 'signatures', 'users')
  const hit = pickExisting([
    path.join(base, `${id}.png`),
    path.join(base, `${id}.jpg`),
    path.join(base, `${id}.jpeg`),
  ])
  return hit ? publicUrlFromAbs(hit) : ''
}

function employeeSignatureUrl(employeeId) {
  const id = String(employeeId || '').trim()
  if (!id) return ''
  const base = path.join(uploadRoot(), 'signatures', 'employees')
  const hit = pickExisting([
    path.join(base, `${id}.png`),
    path.join(base, `${id}.jpg`),
    path.join(base, `${id}.jpeg`),
  ])
  return hit ? publicUrlFromAbs(hit) : ''
}

module.exports = {
  userSignatureUrl,
  employeeSignatureUrl,
}
