// backend/services/transport.telegram.messages.js
const dayjs = require('dayjs')

/* helpers */
const esc   = (s = '') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const d     = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '—')
const t     = (v) => (v ? esc(v) : '—')
const span  = (bk) => `${d(bk.tripDate)} ${t(bk.timeStart)}${bk.timeEnd ? `–${t(bk.timeEnd)}` : ''}`
const first = (bk) => {
  const s = Array.isArray(bk.stops) && bk.stops[0]
  if (!s) return '—'
  const dst = s.destination === 'Other' && s.destinationOther ? s.destinationOther : s.destination
  return esc(dst || '—')
}
const route = (bk) => first(bk)
const pax   = (bk) => `Pax: <b>${Number(bk.passengers || 1)}</b> | Category: ${esc(bk.category || 'Car')}`
const code  = (bk) => `#${esc(bk.shortCode || bk.requestId || bk._id)}`
const cut   = (s, max=300) => (!s ? '' : (String(s).length>max ? `${String(s).slice(0,max-1)}…` : String(s)))

/* ───────── GROUP MESSAGES ───────── */

function newRequestMsg(bk) {
  const emp = bk.employee || {}
  const note = cut(bk.purpose || bk.notes)
  return [
    '🚗 <b>New transport request</b>',
    '=============================',
    `👤 Employee: <b>${esc(emp.name || '')}</b>${emp.employeeId ? ` (${esc(emp.employeeId)})` : ''}`,
    `🏢 Department: ${esc(emp.department || '')}`,
    `📅 When: ${span(bk)}`,
    `📍 Route: ${route(bk)}`,
    `👥 ${pax(bk)}`,
    note ? `📝 Note: ${esc(note)}` : null,
    '-----------------------------',
    code(bk),
  ].filter(Boolean).join('\n')
}

function declinedMsg(bk, reason, adminName) {
  return [
    '⛔ <b>Booking declined</b>',
    '=============================',
    `📅 When: ${span(bk)}`,
    `📍 Route: ${route(bk)}`,
    `🧾 Reason: ${esc(reason || '—')}`,
    `🔧 By: ${esc(adminName || 'Admin')}`,
    '-----------------------------',
    code(bk),
  ].join('\n')
}

function acceptedAssignedMsg(bk) {
  return [
    '✅ <b>Accepted & assigned</b>',
    '=============================',
    `👤 Driver: <b>${esc(bk.assignment?.driverName || '—')}</b>`,
    bk.assignment?.vehicleName ? `🚘 Vehicle: ${esc(bk.assignment.vehicleName)}` : null,
    `📅 When: ${span(bk)}`,
    `📍 Route: ${route(bk)}`,
    `👥 ${pax(bk)}`,
    '-----------------------------',
    code(bk),
  ].filter(Boolean).join('\n')
}

function statusChangedMsg(bk, status, byName) {
  const s = String(status || bk.status || '').toUpperCase()
  return [
    `🟡 <b>Status:</b> ${esc(s)}`,
    '=============================',
    `👤 Driver: ${esc(bk.assignment?.driverName || '—')}`,
    `📅 When: ${span(bk)}`,
    `📍 Route: ${route(bk)}`,
    byName ? `🔧 By: ${esc(byName)}` : null,
    '-----------------------------',
    code(bk),
  ].filter(Boolean).join('\n')
}

/* ───────── DRIVER DM (only the assigned driver) ───────── */

function driverAssignmentDM(bk) {
  const note = cut(bk.purpose || bk.notes, 180)
  return [
    '📥 <b>New assignment</b>',
    `• ${span(bk)}`,
    `• ${route(bk)}`,
    `• ${pax(bk)}`,
    bk.assignment?.vehicleName ? `• Vehicle: ${esc(bk.assignment.vehicleName)}` : null,
    note ? `• Note: ${esc(note)}` : null,
    code(bk),
  ].filter(Boolean).join('\n')
}

function driverStatusDM(bk, status) {
  const s = String(status || bk.status || '').toUpperCase()
  return [
    `🔔 <b>${esc(s)}</b>`,
    `• ${span(bk)}`,
    `• ${route(bk)}`,
    code(bk),
  ].join('\n')
}

module.exports = {
  newRequestMsg,
  declinedMsg,
  acceptedAssignedMsg,
  statusChangedMsg,
  driverAssignmentDM,
  driverStatusDM,
}
