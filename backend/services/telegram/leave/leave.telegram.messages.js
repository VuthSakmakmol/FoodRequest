// backend/services/telegram/leave/leave.telegram.messages.js

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  managerInbox: `${FRONTEND_URL}/leave/requests/manager/inbox`,
  gmInbox: `${FRONTEND_URL}/leave/requests/gm/inbox`,
  cooInbox: `${FRONTEND_URL}/leave/requests/coo/inbox`,
  adminReport: `${FRONTEND_URL}/leave/reports/admin`, // adjust if different
}

function ymd(v) {
  if (!v) return '?'
  const s = String(v)
  return s.length >= 10 ? s.slice(0, 10) : s
}

function employeeLabel(doc, employeeName) {
  const label = employeeName || doc.employeeName || doc.employeeId || doc.requesterLoginId || '—'
  return `👤 Employee: <b>${esc(label)}</b>`
}

function halfLabel(doc) {
  // show half edges quickly
  const sh = doc?.startHalf ? ` start:${doc.startHalf}` : ''
  const eh = doc?.endHalf ? ` end:${doc.endHalf}` : ''
  const legacy = doc?.isHalfDay && doc?.dayPart ? ` ${doc.dayPart}` : ''
  return (sh || eh || legacy) ? `🌓 Half:${esc((sh + eh + legacy).trim())}` : ''
}

function summary(doc) {
  return [
    `🏷️ Type: <b>${esc(doc?.leaveTypeCode || '-')}</b>`,
    `📅 Date: <b>${esc(ymd(doc?.startDate))} → ${esc(ymd(doc?.endDate || doc?.startDate))}</b>`,
    doc?.totalDays ? `🧮 Days: <b>${esc(String(doc.totalDays))}</b>` : '',
    halfLabel(doc),
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function actionLinkLine(url, label) {
  if (!url) return ''
  return `🔗 ${esc(label)}: ${esc(url)}`
}

function employeeSubmitted(doc) {
  return [
    '✅ <b>Leave request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    `📌 Status: <b>${esc(String(doc?.status || 'SUBMITTED'))}</b>`,
  ]
    .filter(Boolean)
    .join('\n')
}

function managerNew(doc, employeeName) {
  return [
    '🗓️ <b>New Leave request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    '📌 Status: Waiting for Manager approval',
    '',
    actionLinkLine(LINKS.managerInbox, 'Open Manager Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function gmNew(doc, employeeName) {
  return [
    '🗓️ <b>New Leave request (GM)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    '📌 Status: Waiting for GM approval',
    doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : '',
    '',
    actionLinkLine(LINKS.gmInbox, 'Open GM Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function cooNew(doc, employeeName) {
  return [
    '🗓️ <b>New Leave request (COO)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    '📌 Status: Waiting for COO approval',
    doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : '',
    doc?.gmComment ? `💬 GM comment: ${esc(doc.gmComment)}` : '',
    '',
    actionLinkLine(LINKS.cooInbox, 'Open COO Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeDecision(doc, roleLabel) {
  const status = String(doc?.status || '').toUpperCase()
  const emoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : status === 'CANCELLED' ? '🚫' : 'ℹ️'

  let extra = ''
  if (roleLabel === 'Manager' && doc?.managerComment) extra = `💬 Manager comment: ${esc(doc.managerComment)}`
  if (roleLabel === 'GM' && doc?.gmComment) extra = `💬 GM comment: ${esc(doc.gmComment)}`
  if (roleLabel === 'COO' && doc?.cooComment) extra = `💬 COO comment: ${esc(doc.cooComment)}`

  return [
    `${emoji} <b>Leave request ${esc(status || 'UPDATED')} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

function adminCreated(doc, employeeName) {
  return [
    '📣 <b>Leave request created</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    `📌 Status: <b>${esc(String(doc?.status || '-'))}</b>`,
    '',
    actionLinkLine(LINKS.adminReport, 'Open Admin Report'),
  ]
    .filter(Boolean)
    .join('\n')
}

function adminUpdated(doc, employeeName) {
  return [
    '📣 <b>Leave request updated</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    `📌 Status: <b>${esc(String(doc?.status || '-'))}</b>`,
    '',
    actionLinkLine(LINKS.adminReport, 'Open Admin Report'),
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  employeeSubmitted,
  managerNew,
  gmNew,
  cooNew,
  employeeDecision,
  adminCreated,
  adminUpdated,
}