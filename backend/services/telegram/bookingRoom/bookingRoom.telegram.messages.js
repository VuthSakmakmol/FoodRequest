/* eslint-disable no-console */
// backend/services/telegram/bookingRoom/bookingRoom.telegram.messages.js

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function ymd(v) {
  if (!v) return '?'
  const t = String(v)
  return t.length >= 10 ? t.slice(0, 10) : t
}

function fmtTime(v) {
  return s(v) || '?'
}

function bookingTypeLabel(doc) {
  const hasRoom = !!doc?.roomRequired
  const hasMaterial = !!doc?.materialRequired
  if (hasRoom && hasMaterial) return 'Room + Material'
  if (hasRoom) return 'Room Only'
  if (hasMaterial) return 'Material Only'
  return '—'
}

function materialItemsToText(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = Number(x?.qty || 0)
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

function bookingSummary(doc) {
  const roomLine = doc?.roomRequired
    ? `🏢 Room: <b>${esc(doc?.roomName || doc?.roomCode || '—')}</b>`
    : `🏢 Room: <b>Not required</b>`

  const materialLine = doc?.materialRequired
    ? `📦 Materials: <b>${esc(materialItemsToText(doc?.materials) || '—')}</b>`
    : `📦 Materials: <b>Not required</b>`

  return [
    `📅 Date: <b>${esc(ymd(doc?.bookingDate))}</b>`,
    `⏰ Time: <b>${esc(fmtTime(doc?.timeStart))} - ${esc(fmtTime(doc?.timeEnd))}</b>`,
    `📝 Meeting: <b>${esc(doc?.meetingTitle || '—')}</b>`,
    `📂 Type: <b>${esc(bookingTypeLabel(doc))}</b>`,
    roomLine,
    materialLine,
  ].join('\n')
}

function employeeLabel(doc) {
  const label =
    doc?.employee?.name ||
    doc?.employeeName ||
    doc?.employeeId ||
    doc?.requesterLoginId ||
    '—'

  return `👤 Employee: <b>${esc(label)}</b>`
}

function purposeLine(doc) {
  return doc?.purpose ? `📌 Purpose: ${esc(doc.purpose)}` : ''
}

function requirementLine(doc) {
  return doc?.requirementNote ? `📝 Note: ${esc(doc.requirementNote)}` : ''
}

function roomDecisionLine(doc) {
  const st = up(doc?.roomStatus)
  if (!st || st === 'NOT_REQUIRED') return ''
  return `🏢 Room Status: <b>${esc(st)}</b>`
}

function materialDecisionLine(doc) {
  const st = up(doc?.materialStatus)
  if (!st || st === 'NOT_REQUIRED') return ''
  return `📦 Material Status: <b>${esc(st)}</b>`
}

function friendlyEmployeeStatus(doc) {
  const overall = up(doc?.overallStatus)
  const room = up(doc?.roomStatus)
  const material = up(doc?.materialStatus)

  if (overall === 'CANCELLED') return 'Cancelled'
  if (overall === 'APPROVED') return 'Approved'
  if (overall === 'REJECTED') return 'Rejected'
  if (overall === 'PARTIAL_APPROVED') return 'Partially approved'

  if (room === 'PENDING' && material === 'PENDING') return 'Waiting for Room and Material approval'
  if (room === 'PENDING') return 'Waiting for Room approval'
  if (material === 'PENDING') return 'Waiting for Material approval'

  return 'Pending'
}

/* ───────────────── Approver messages ───────────────── */

function roomAdminNewBooking(doc) {
  return [
    '🏢 <b>New Meeting Room request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc),
    bookingSummary(doc),
    '📌 Status: Waiting for Room approval',
    purposeLine(doc),
    requirementLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

function materialAdminNewBooking(doc) {
  return [
    '📦 <b>New Meeting Room material request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc),
    bookingSummary(doc),
    '📌 Status: Waiting for Material approval',
    purposeLine(doc),
    requirementLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ───────────────── Employee messages ───────────────── */

function employeeSubmitted(doc) {
  return [
    '✅ <b>Meeting room request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    bookingSummary(doc),
    `📌 Status: <b>${esc(friendlyEmployeeStatus(doc))}</b>`,
    purposeLine(doc),
    requirementLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeUpdated(doc) {
  return [
    '✏️ <b>Meeting room request updated</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    bookingSummary(doc),
    `📌 Status: <b>${esc(friendlyEmployeeStatus(doc))}</b>`,
    purposeLine(doc),
    requirementLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeCancelled(doc) {
  return [
    '🚫 <b>Meeting room request cancelled</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    bookingSummary(doc),
    '📌 Status: <b>Cancelled</b>',
    doc?.cancelReason ? `📝 Cancel reason: ${esc(doc.cancelReason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeRoomDecision(doc) {
  const overall = friendlyEmployeeStatus(doc)
  return [
    '🏢 <b>Room approval updated</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    bookingSummary(doc),
    roomDecisionLine(doc),
    materialDecisionLine(doc),
    `📌 Overall: <b>${esc(overall)}</b>`,
    doc?.roomApproval?.note ? `💬 Room note: ${esc(doc.roomApproval.note)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeMaterialDecision(doc) {
  const overall = friendlyEmployeeStatus(doc)
  return [
    '📦 <b>Material approval updated</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    bookingSummary(doc),
    roomDecisionLine(doc),
    materialDecisionLine(doc),
    `📌 Overall: <b>${esc(overall)}</b>`,
    doc?.materialApproval?.note ? `💬 Material note: ${esc(doc.materialApproval.note)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  roomAdminNewBooking,
  materialAdminNewBooking,
  employeeSubmitted,
  employeeUpdated,
  employeeCancelled,
  employeeRoomDecision,
  employeeMaterialDecision,
}