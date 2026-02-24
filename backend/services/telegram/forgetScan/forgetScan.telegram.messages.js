// backend/services/telegram/forgetScan/forgetScan.telegram.messages.js

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  managerInbox: `${FRONTEND_URL}/leave/forget-scan/manager/inbox`,
  gmInbox: `${FRONTEND_URL}/leave/forget-scan/gm/inbox`,
  cooInbox: `${FRONTEND_URL}/leave/forget-scan/coo/inbox`,
  adminReport: `${FRONTEND_URL}/leave/forget-scan/admin/report`,
}

function ymd(v) {
  if (!v) return '?'
  const s = String(v)
  return s.length >= 10 ? s.slice(0, 10) : s
}

function up(v) {
  return String(v ?? '').trim().toUpperCase()
}

function uniqUpper(arr) {
  return [...new Set((arr || []).map((x) => up(x)).filter(Boolean))]
}

function typeLabel(t) {
  const v = up(t)
  if (v === 'FORGET_IN') return 'FORGET IN'
  if (v === 'FORGET_OUT') return 'FORGET OUT'
  return v || '-'
}

/** ✅ NEW: supports multiple types (forgotTypes[]) with fallback to old forgotType */
function typesText(doc) {
  const arr = Array.isArray(doc?.forgotTypes) ? doc.forgotTypes : []
  let types = uniqUpper(arr)

  // backward compatible fallback
  if (!types.length && doc?.forgotType) types = [up(doc.forgotType)]

  const hasIn = types.includes('FORGET_IN')
  const hasOut = types.includes('FORGET_OUT')

  if (hasIn && hasOut) return 'FORGET IN + FORGET OUT'
  if (hasIn) return 'FORGET IN'
  if (hasOut) return 'FORGET OUT'
  return '-'
}

function employeeLabel(doc, employeeName) {
  const label = employeeName || doc.employeeName || doc.employeeId || doc.requesterLoginId || '—'
  return `👤 Employee: <b>${esc(label)}</b>`
}

function actionLinkLine(url, label) {
  if (!url) return ''
  return `🔗 ${esc(label)}: ${esc(url)}`
}

function summary(doc) {
  return [
    `📅 Date: <b>${esc(ymd(doc?.forgotDate))}</b>`,
    `🧾 Type: <b>${esc(typesText(doc))}</b>`,
    // ✅ reason optional
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeSubmitted(doc) {
  return [
    '✅ <b>Forget Scan request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    `📌 Status: <b>${esc(String(doc?.status || 'SUBMITTED'))}</b>`,
  ]
    .filter(Boolean)
    .join('\n')
}

function managerNew(doc, employeeName) {
  return [
    '🕘 <b>New Forget Scan request</b>',
    '━━━━━━━━━━━━━━━━━━━━',
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
    '🕘 <b>New Forget Scan request (GM)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
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
    '🕘 <b>New Forget Scan request (COO)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
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
  const status = up(doc?.status || '')
  const emoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : status === 'CANCELLED' ? '🚫' : 'ℹ️'

  let extra = ''
  if (roleLabel === 'Manager' && doc?.managerComment) extra = `💬 Manager comment: ${esc(doc.managerComment)}`
  if (roleLabel === 'GM' && doc?.gmComment) extra = `💬 GM comment: ${esc(doc.gmComment)}`
  if (roleLabel === 'COO' && doc?.cooComment) extra = `💬 COO comment: ${esc(doc.cooComment)}`

  return [
    `${emoji} <b>Forget Scan ${esc(status || 'UPDATED')} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

function adminCreated(doc, employeeName) {
  return [
    '📣 <b>Forget Scan created</b>',
    '━━━━━━━━━━━━━━━━━━━━',
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
    '📣 <b>Forget Scan updated</b>',
    '━━━━━━━━━━━━━━━━━━━━',
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