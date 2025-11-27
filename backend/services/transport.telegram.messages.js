// backend/services/transport.telegram.messages.js
const dayjs = require('dayjs')

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const d = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '—')
const t = (v) => (v ? esc(v) : '—')
const span = (bk) =>
  `${d(bk.tripDate)} ${t(bk.timeStart)}${
    bk.timeEnd ? `–${t(bk.timeEnd)}` : ''
  }`

/* ──────────────────────────────
 * Single / first stop helpers (kept for compatibility)
 * ────────────────────────────── */
const firstStop = (bk) => {
  const s = Array.isArray(bk.stops) && bk.stops[0]
  if (!s) return '—'
  const dst =
    s.destination === 'Other' && s.destinationOther
      ? s.destinationOther
      : s.destination
  return esc(dst || '—')
}

// old route() kept in case other files use it
const route = (bk) => firstStop(bk)

const pax = (bk) =>
  `Pax: <b>${Number(bk.passengers || 1)}</b> | Category: ${esc(
    bk.category || 'Car'
  )}`

const code = (bk) => `#${esc(bk.shortCode || bk.requestId || bk._id)}`

const cut = (s, max = 300) =>
  !s
    ? ''
    : String(s).length > max
    ? `${String(s).slice(0, max - 1)}…`
    : String(s)

/* ──────────────────────────────
 * NEW: multi-stop formatting (EN + KH)
 * ────────────────────────────── */

/**
 * Generic formatter for stops list with optional map links
 *
 * @param {Object} bk  booking
 * @param {Object} opt options:
 *    - label: heading label (e.g. 'Route' / 'ទិសដៅ')
 *    - emoji: symbol before heading (e.g. '📍' or '•')
 *    - includeMap: boolean, add map link if mapLink exists
 *    - mapLabel: text before URL (e.g. 'map' / 'ផែនទី')
 *    - mapLinkText: anchor text (e.g. 'Map' / 'ផែនទី')
 */
function formatStopsLines(bk, opt = {}) {
  const {
    label = 'Route',
    emoji = '📍',
    includeMap = false,
    mapLabel = 'map',
    mapLinkText = 'Map'
  } = opt

  const stops = Array.isArray(bk.stops) ? bk.stops : []

  if (!stops.length) {
    return `${emoji} ${label}: —`
  }

  const lines = stops.map((s, idx) => {
    const dst =
      s.destination === 'Other' && s.destinationOther
        ? s.destinationOther
        : s.destination

    let line = `#${idx + 1}: ${esc(dst || '—')}`

    const rawUrl = (s.mapLink || '').trim()
    if (includeMap && rawUrl) {
      const safeUrl = esc(rawUrl)
      line += ` (${esc(mapLabel)}: <a href="${safeUrl}">${esc(mapLinkText)}</a>)`
    }

    return `• ${line}`
  })

  return [`${emoji} ${label}:`, ...lines].join('\n')
}

// English version (for group + employee)
const stopsListEn = (bk, includeMap = true) =>
  formatStopsLines(bk, {
    label: 'Route',
    emoji: '📍',
    includeMap,
    mapLabel: 'map',
    mapLinkText: 'Map'
  })

// Khmer label version for driver/messenger
const stopsListKh = (bk, includeMap = true) =>
  formatStopsLines(bk, {
    label: 'ទិសដៅ',
    emoji: '•',
    includeMap,
    mapLabel: 'ផែនទី',
    mapLinkText: 'ផែនទី'
  })

/* ──────────────────────────────
 * Khmer helpers for driver/messenger
 * ────────────────────────────── */

const CATEGORY_KH = {
  Car: 'ឡាន',
  Messenger: 'អ្នកបញ្ជូនឯកសារ'
}

const paxKh = (bk) => {
  const catKh = CATEGORY_KH[bk.category] || bk.category || 'Car'
  return `អ្នកដំណើរ: <b>${Number(bk.passengers || 1)}</b> | ប្រភេទ: ${esc(catKh)}`
}

const STATUS_KH = {
  PENDING: 'កំពុងរង់ចាំ',
  ACCEPTED: 'ទទួលយក',
  ON_ROAD: 'កំពុងធ្វើដំណើរ',
  ARRIVING: 'កំពុងដល់ក្បែរគោលដៅ',
  COMPLETED: 'បញ្ចប់ដំណើរ',
  DELAYED: 'ពន្យារពេល',
  CANCELLED: 'បោះបង់'
}

/* ──────────────────────────────
 * Purpose mapping EN -> KH (for assignee only)
 * ────────────────────────────── */
const PURPOSE_KH = {
  'Bring & Pick up': 'នាំទៅ និង ចាំទទួល',
  'Bring Customer': 'ទៅយកភ្ញៀវមកក្រុមហ៊ុន',
  'Pick up Customer': 'ទៅទទួលភ្ញៀវ',
  Meeting: 'ទៅប្រជុំការងារ',
  'Check quality in subcon': 'ទៅពិនិត្យគុណភាពនៅរោងចក្រ Subcon',
  'Release Document': 'យកឯកសារចេញ / បញ្ចេញឯកសារ',
  'Submit payment': 'ទៅដាក់បង់ប្រាក់',
  'Collect doc back': 'យកឯកសារមកវិញ',
  'Revise Document': 'ទៅកែប្រែឯកសារ',
  'Send the fabric': 'យកក្រណាត់ទៅផ្ញើ',
  'Pick  parcel': 'ទៅយកកញ្ចប់ / Parcel',
  'Bring binding tape': 'ទៅយកខ្សែកក់ / Binding tape',
  'Pick up Accessory': 'ទៅយកសម្ភារៈ',
  'Pay for NSSF': 'បង់លុយ បសស',
  Withdraw: 'ទៅដកលុយ',
  'Send Document TT': 'ផ្ញើឯកសារ TT',
  'Pick up SGS inspector': 'ទៅយកអ្នកត្រួតពិនិត្យ SGS'
}

function purposeLineKh(bk) {
  const raw = (bk.purpose || '').trim()
  if (!raw) return null
  const kh = PURPOSE_KH[raw]
  if (kh) {
    return `• គោលបំណងដំណើរ៖ ${esc(kh)}`
  }
  // fallback if we add new English purpose but forget to map
  return `• Purpose: ${esc(raw)}`
}

/* 👉 customer contact line in Khmer for assignees */
function customerContactLineKh(bk) {
  const c = (bk.customerContact || '').trim()
  if (!c) return null
  return `• លេខទំនាក់ទំនងរបស់ភ្ញៀវ៖ ${esc(c)}`
}

/* ──────────────────────────────
 * Group & Admin Messages (EN)
 * ────────────────────────────── */
function newRequestMsg(bk) {
  const emp = bk.employee || {}
  const purpose = cut(bk.purpose)
  const notes = cut(bk.notes)

  return [
    '🚗 <b>New transport request</b>',
    '=============================',
    `👤 Employee: <b>${esc(emp.name || '')}</b>${
      emp.employeeId ? ` (${esc(emp.employeeId)})` : ''
    }`,
    `🏢 Department: ${esc(emp.department || '')}`,
    `📅 When: ${span(bk)}`,
    `👥 ${pax(bk)}`,
    stopsListEn(bk, true),
    purpose ? `🎯 Purpose: ${esc(purpose)}` : null,
    notes ? `📝 Note: ${esc(notes)}` : null,
    '-----------------------------'
  ]
    .filter(Boolean)
    .join('\n')
}

function declinedMsg(bk, reason, adminName) {
  return [
    '⛔ <b>Booking declined</b>',
    '=============================',
    `📅 When: ${span(bk)}`,
    stopsListEn(bk, true),
    `🧾 Reason: ${esc(reason || '—')}`,
    `🔧 By: ${esc(adminName || 'Admin')}`,
    '-----------------------------'
  ].join('\n')
}

function acceptedAssignedMsg(bk) {
  return [
    '✅ <b>Accepted & assigned</b>',
    '=============================',
    `👤 Driver: <b>${esc(bk.assignment?.driverName || '—')}</b>`,
    bk.assignment?.vehicleName
      ? `🚘 Vehicle: ${esc(bk.assignment.vehicleName)}`
      : null,
    `📅 When: ${span(bk)}`,
    `👥 ${pax(bk)}`,
    stopsListEn(bk, true),
    '-----------------------------'
  ]
    .filter(Boolean)
    .join('\n')
}

function statusChangedMsg(bk, status, byName) {
  const s = String(status || bk.status || '').toUpperCase()
  return [
    `🟡 <b>Status:</b> ${esc(s)}`,
    '=============================',
    `👤 Driver: ${esc(bk.assignment?.driverName || '—')}`,
    `📅 When: ${span(bk)}`,
    stopsListEn(bk, true),
    byName ? `🔧 By: ${esc(byName)}` : null,
    '-----------------------------'
  ]
    .filter(Boolean)
    .join('\n')
}

/* ──────────────────────────────
 * 🚚 Direct messages to Driver / Messenger (KH)
 * ────────────────────────────── */
function driverAssignmentDM(bk) {
  const note = cut(bk.notes, 180)
  const purpose = purposeLineKh(bk)
  const contact = customerContactLineKh(bk)

  return [
    '📥 <b>ភារកិច្ចដឹកជញ្ជូនថ្មី</b>',
    `• ពេលវេលា៖ ${span(bk)}`,
    stopsListKh(bk, true),
    purpose,
    contact,
    `• ${paxKh(bk)}`,
    bk.assignment?.vehicleName
      ? `• ឡាន៖ ${esc(bk.assignment.vehicleName)}`
      : null,
    note ? `• កំណត់ចំណាំ៖ ${esc(note)}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

function driverStatusDM(bk, status) {
  const s = String(status || bk.status || '').toUpperCase()
  const labelKh = STATUS_KH[s] || s
  const purpose = purposeLineKh(bk)
  const contact = customerContactLineKh(bk)

  return [
    `🔔 <b>ស្ថានភាពថ្មី៖ ${esc(labelKh)}</b>`,
    `• ពេលវេលា៖ ${span(bk)}`,
    stopsListKh(bk, true),
    purpose,
    contact
  ]
    .filter(Boolean)
    .join('\n')
}

function driverAckGroupMsg(bk, response) {
  const r = String(response || bk?.assignment?.driverAck || '').toUpperCase()
  const label =
    r === 'ACCEPTED'
      ? '✅ Driver accepted'
      : r === 'DECLINED'
      ? '⛔ Driver declined'
      : `ℹ️ Driver ack: ${r}`
  return [
    `${label}`,
    '=============================',
    `👤 Driver: ${esc(bk.assignment?.driverName || '—')}`,
    `📅 When: ${span(bk)}`,
    stopsListEn(bk, true),
    '-----------------------------'
  ].join('\n')
}

function driverAckConfirmDM(bk, response) {
  const r = String(response || bk?.assignment?.driverAck || '').toUpperCase()
  let label
  if (r === 'ACCEPTED') {
    label = '👍 អ្នកបានព្រមទទួលភារកិច្ច'
  } else if (r === 'DECLINED') {
    label = '👋 អ្នកបានបដិសេធភារកិច្ច'
  } else {
    label = `ℹ️ ការឆ្លើយតប៖ ${r}`
  }
  const purpose = purposeLineKh(bk)
  const contact = customerContactLineKh(bk)

  return [
    `<b>${esc(label)}</b>`,
    `• ពេលវេលា៖ ${span(bk)}`,
    stopsListKh(bk, true),
    purpose,
    contact
  ]
    .filter(Boolean)
    .join('\n')
}

/* ──────────────────────────────
 * 🧍 Employee Direct Messages (EN)
 * ────────────────────────────── */
function employeeRequestDM(bk) {
  return [
    '✅ <b>Your booking request was received</b>',
    `• ${span(bk)}`,
    `• ${pax(bk)}`,
    stopsListEn(bk, true)
  ].join('\n')
}

function employeeAcceptedDM(bk) {
  return [
    '🚗 <b>Your booking was approved</b>',
    `Driver: ${esc(bk.assignment?.driverName || '—')}`,
    bk.assignment?.vehicleName
      ? `Vehicle: ${esc(bk.assignment.vehicleName)}`
      : null,
    `Date: ${span(bk)}`,
    stopsListEn(bk, true)
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeDeclinedDM(bk, reason, adminName) {
  return [
    '❌ <b>Your booking was declined</b>',
    `Reason: ${esc(reason || '—')}`,
    `By: ${esc(adminName || 'Admin')}`,
    `Date: ${span(bk)}`,
    stopsListEn(bk, true)
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeStatusDM(bk, status) {
  const s = String(status || bk.status || '').toUpperCase()
  return [
    `🔔 <b>Trip status update:</b> ${esc(s)}`,
    `• ${span(bk)}`,
    stopsListEn(bk, true)
  ].join('\n')
}

function employeeDriverAckDM(bk, response) {
  const r = String(response || bk?.assignment?.driverAck || '').toUpperCase()
  const label =
    r === 'ACCEPTED'
      ? '✅ Driver has accepted your booking'
      : r === 'DECLINED'
      ? '⚠️ Driver declined your booking'
      : `ℹ️ Driver response: ${r}`
  return [
    `${label}`,
    `• ${span(bk)}`,
    stopsListEn(bk, true)
  ].join('\n')
}

/* ──────────────────────────────
 * Exports
 * ────────────────────────────── */
module.exports = {
  // helpers retained that might be used elsewhere
  route,
  firstStop,
  pax,
  code,

  // group/admin messages
  newRequestMsg,
  declinedMsg,
  acceptedAssignedMsg,
  statusChangedMsg,
  driverAckGroupMsg,

  // driver / messenger DMs (KH)
  driverAssignmentDM,
  driverStatusDM,
  driverAckConfirmDM,

  // Employee messages (EN)
  employeeRequestDM,
  employeeAcceptedDM,
  employeeDeclinedDM,
  employeeStatusDM,
  employeeDriverAckDM
}
