// backend/services/leave/leave.telegram.messages.js

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function formatDateRange(doc) {
  const s = doc.startDate ? String(doc.startDate).slice(0, 10) : '?'
  const e = doc.endDate ? String(doc.endDate).slice(0, 10) : '?'
  const days = Number(doc.totalDays || 0) || '?'
  const suffix = Number(days) === 1 ? 'day' : 'days'
  return `${s} → ${e} (${days} ${suffix})`
}

/* ─────────────────────────────
 * Manager: new request DM
 * Called when employee submits a request
 * ───────────────────────────── */
function managerNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  const reason = doc.reason ? `\n📝 Reason: ${esc(doc.reason)}` : ''
  const idLine = doc._id ? `\n🆔 ID: <code>${esc(String(doc._id))}</code>` : ''

  return [
    '📝 <b>New leave request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `👤 Employee: <b>${esc(employeeName || doc.employeeId)}</b>`,
    `📄 Type: ${esc(doc.leaveTypeCode)}`,
    `📅 Period: ${esc(range)}`,
    '📌 Status: Waiting for Manager approval',
    reason,
    idLine,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * GM: new request DM
 * Called after Manager APPROVE (status = PENDING_GM)
 * ───────────────────────────── */
function gmNewRequest(doc, employeeName) {
  const range = formatDateRange(doc)
  const reason = doc.reason ? `\n📝 Reason: ${esc(doc.reason)}` : ''
  const mgrComment = doc.managerComment
    ? `\n💬 Manager comment: ${esc(doc.managerComment)}`
    : ''
  const idLine = doc._id ? `\n🆔 ID: <code>${esc(String(doc._id))}</code>` : ''

  return [
    '📝 <b>New leave request (GM approval)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `👤 Employee: <b>${esc(employeeName || doc.employeeId)}</b>`,
    `📄 Type: ${esc(doc.leaveTypeCode)}`,
    `📅 Period: ${esc(range)}`,
    '📌 Status: Waiting for GM approval',
    mgrComment,
    reason,
    idLine,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
 * Employee: decision DM
 * Used for both Manager + GM decisions
 * roleLabel = "Manager" | "GM"
 * ───────────────────────────── */
function employeeDecision(doc, roleLabel) {
  const range = formatDateRange(doc)
  const status = String(doc.status || '').toUpperCase()
  const emoji =
    status === 'APPROVED'
      ? '✅'
      : status === 'REJECTED'
        ? '❌'
        : 'ℹ️'

  let comment = ''
  if (roleLabel === 'Manager' && doc.managerComment) {
    comment = `\n💬 Manager comment: ${esc(doc.managerComment)}`
  }
  if (roleLabel === 'GM' && doc.gmComment) {
    comment = `\n💬 GM comment: ${esc(doc.gmComment)}`
  }

  return [
    `${emoji} <b>Leave ${esc(status)} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📄 Type: ${esc(doc.leaveTypeCode)}`,
    `📅 Period: ${esc(range)}`,
    comment,
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  managerNewRequest,
  gmNewRequest,
  employeeDecision,
}
