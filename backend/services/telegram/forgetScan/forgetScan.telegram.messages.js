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

/** ✅ supports multiple types (forgotTypes[]) with fallback to old forgotType */
function typesText(doc) {
  const arr = Array.isArray(doc?.forgotTypes) ? doc.forgotTypes : []
  let types = uniqUpper(arr)
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
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeSubmitted(doc) {
  const st = up(doc?.status || '')
  const waiting = st === 'PENDING_GM' ? 'GM' : 'Manager'
  return [
    '✅ <b>Forget Scan request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    `📌 Status: Waiting for <b>${waiting}</b> approval`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * ✅ SPECIAL FLOW: first approver only
 * Approve = FINAL (APPROVED), no next approver
 */
function managerNew(doc, employeeName) {
  return [
    '🕘 <b>Forget Scan request</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    '📌 Action: <b> Waiting for Approval',
    '',
    actionLinkLine(LINKS.managerInbox, 'Click the link to Approve or Reject'),
  ]
    .filter(Boolean)
    .join('\n')
}

function gmNew(doc, employeeName) {
  return [
    '🕘 <b>Forget Scan request pending (GM)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    '📌 Action: <b> Waiting for Approval',
    '',
    actionLinkLine(LINKS.gmInbox, 'Click the link to Approve or Reject'),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeDecision(doc, roleLabel) {
  const status = up(doc?.status || '')
  const emoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : status === 'CANCELLED' ? '🚫' : 'ℹ️'

  let extra = ''
  if (roleLabel === 'Manager' && doc?.managerComment) extra = `💬 Manager note: ${esc(doc.managerComment)}`
  if (roleLabel === 'GM' && doc?.gmComment) extra = `💬 GM note: ${esc(doc.gmComment)}`
  if (roleLabel === 'System' && doc?.cancelledBy) extra = `👤 Cancelled by: ${esc(doc.cancelledBy)}`

  const finalLine =
    status === 'APPROVED'
      ? '🎉 Result: <b>Approved</b>'
      : status === 'REJECTED'
      ? '⚠️ Result: <b>Rejected</b>'
      : status === 'CANCELLED'
      ? '🚫 Result: <b>Cancelled</b>'
      : `📌 Status: <b>${esc(status || 'UPDATED')}</b>`

  return [
    `${emoji} <b>Forget Scan update</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    finalLine,
    roleLabel ? `👤 By: <b>${esc(roleLabel)}</b>` : '',
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  employeeSubmitted,
  managerNew,
  gmNew,
  employeeDecision,
}