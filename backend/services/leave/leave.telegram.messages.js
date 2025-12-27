// backend/services/leave/leave.telegram.messages.js

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// ✅ Ideally use FRONTEND_URL in env
const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  managerInbox: `${FRONTEND_URL}/leave/manager/inbox`,
  gmInbox: `${FRONTEND_URL}/leave/gm/inbox`,
  cooInbox: `${FRONTEND_URL}/leave/coo/inbox`,
  adminInbox: `${FRONTEND_URL}/leave/admin/manager-inbox`,
}

function formatDateRange(doc) {
  const s = doc.startDate ? String(doc.startDate).slice(0, 10) : '?'
  const e = doc.endDate ? String(doc.endDate).slice(0, 10) : '?'
  const days = Number(doc.totalDays || 0)
  const suffix = days === 1 ? 'day' : 'days'
  return `${s} → ${e} (${Number.isFinite(days) ? days : '?'} ${suffix})`
}

function reasonLine(doc) {
  return doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : ''
}
function managerCommentLine(doc) {
  return doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : ''
}
function gmCommentLine(doc) {
  return doc?.gmComment ? `💬 GM comment: ${esc(doc.gmComment)}` : ''
}
function cooCommentLine(doc) {
  return doc?.cooComment ? `💬 COO comment: ${esc(doc.cooComment)}` : ''
}

function employeeLabel(doc, employeeName) {
  const label = employeeName || doc.employeeId || doc.requesterLoginId || '—'
  return `👤 Employee: <b>${esc(label)}</b>`
}

function actionLinkLine(url, label) {
  if (!url) return ''
  return `🔗 ${esc(label)}: ${esc(url)}`
}

/* ─────────────────────────────
 * Manager: new request DM
 * ───────────────────────────── */
function managerNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📝 <b>New leave request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    '📌 Status: Waiting for Manager approval',
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.managerInbox, 'Open Manager Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * GM: new request DM
 * ───────────────────────────── */
function gmNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  const mode = String(doc.approvalMode || 'GM_ONLY').toUpperCase()

  const statusLine =
    mode === 'GM_AND_COO'
      ? '📌 Status: Shared final approval (GM or COO)'
      : '📌 Status: Waiting for GM approval'

  return [
    '📝 <b>New leave request (GM approval)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    statusLine,
    managerCommentLine(doc),
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.gmInbox, 'Open GM Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * COO: new request DM (NEW)
 * ───────────────────────────── */
function cooNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📝 <b>New leave request (COO approval)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    '📌 Status: Shared final approval (GM or COO)',
    managerCommentLine(doc),
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.cooInbox, 'Open COO Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * Employee: submit success confirmation
 * ───────────────────────────── */
function employeeSubmitted(doc) {
  const range = formatDateRange(doc)
  return [
    '✅ <b>Leave request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    '📌 Status: Submitted',
    reasonLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * Employee: decision DM (Manager/GM/COO)
 * ───────────────────────────── */
function employeeDecision(doc, roleLabel) {
  const range = formatDateRange(doc)
  const status = String(doc.status || '').toUpperCase()
  const emoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : 'ℹ️'

  let comment = ''
  if (roleLabel === 'Manager' && doc.managerComment) comment = `\n${managerCommentLine(doc)}`
  if (roleLabel === 'GM' && doc.gmComment) comment = `\n${gmCommentLine(doc)}`
  if (roleLabel === 'COO' && doc.cooComment) comment = `\n${cooCommentLine(doc)}`

  return [
    `${emoji} <b>Leave ${esc(status)} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    comment,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * LEAVE_ADMIN: activity logs (ONLY LEAVE_ADMIN)
 * ───────────────────────────── */
function leaveAdminNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📣 <b>Leave request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    `📌 Status: ${esc(String(doc.status || '—'))}`,
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.adminInbox, 'Open Leave Admin Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function leaveAdminManagerDecision(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📣 <b>Manager decision</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    `📌 Status: ${esc(String(doc.status || '—'))}`,
    managerCommentLine(doc),
    '',
    actionLinkLine(LINKS.adminInbox, 'Open Leave Admin Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function leaveAdminGmDecision(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📣 <b>GM decision</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    `📌 Status: ${esc(String(doc.status || '—'))}`,
    gmCommentLine(doc),
    '',
    actionLinkLine(LINKS.adminInbox, 'Open Leave Admin Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function leaveAdminCooDecision(doc, employeeName) {
  const range = formatDateRange(doc)
  return [
    '📣 <b>COO decision</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    `📄 Type: ${esc(doc.leaveTypeCode || '—')}`,
    `📅 Period: ${esc(range)}`,
    `📌 Status: ${esc(String(doc.status || '—'))}`,
    cooCommentLine(doc),
    '',
    actionLinkLine(LINKS.adminInbox, 'Open Leave Admin Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  managerNewRequest,
  gmNewRequest,
  cooNewRequest,
  employeeSubmitted,
  employeeDecision,

  // leave_admin only
  leaveAdminNewRequest,
  leaveAdminManagerDecision,
  leaveAdminGmDecision,
  leaveAdminCooDecision,
}
