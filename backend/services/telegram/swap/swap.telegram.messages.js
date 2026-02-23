// backend/services/telegram/swap/swap.telegram.messages.js

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  managerInbox: `${FRONTEND_URL}/leave/swap-day/manager/inbox`,
  gmInbox: `${FRONTEND_URL}/leave/swap-day/gm/inbox`,
  cooInbox: `${FRONTEND_URL}/leave/swap-day/coo/inbox`,
}

function ymd(v) {
  if (!v) return '?'
  const s = String(v)
  return s.length >= 10 ? s.slice(0, 10) : s
}

function fmtRange(start, end) {
  const s = ymd(start)
  const e = ymd(end || start)
  return `${s} → ${e}`
}

function swapSummary(doc) {
  const workRange = fmtRange(doc?.requestStartDate, doc?.requestEndDate)
  const offRange = fmtRange(doc?.offStartDate, doc?.offEndDate)

  const reqDays = Number(doc?.requestTotalDays || 0)
  const offDays = Number(doc?.offTotalDays || 0)

  const reqLabel = Number.isFinite(reqDays) && reqDays > 0 ? `${reqDays} day${reqDays === 1 ? '' : 's'}` : '?'
  const offLabel = Number.isFinite(offDays) && offDays > 0 ? `${offDays} day${offDays === 1 ? '' : 's'}` : '?'

  return [
    `🧩 Work (swap-in): <b>${esc(workRange)}</b> (${esc(reqLabel)})`,
    `🏖️ Off  (swap-out): <b>${esc(offRange)}</b> (${esc(offLabel)})`,
  ].join('\n')
}

function reasonLine(doc) {
  return doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : ''
}

function commentLine(label, v) {
  return v ? `💬 ${esc(label)} comment: ${esc(v)}` : ''
}

function employeeLabel(doc, employeeName) {
  const label = employeeName || doc.employeeName || doc.employeeId || doc.requesterLoginId || '—'
  return `👤 Employee: <b>${esc(label)}</b>`
}

function actionLinkLine(url, label) {
  if (!url) return ''
  return `🔗 ${esc(label)}: ${esc(url)}`
}

function managerNewSwap(doc, employeeName) {
  return [
    '🔁 <b>New Swap Working Day request</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    swapSummary(doc),
    '📌 Status: Waiting for Manager approval',
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.managerInbox, 'Open Manager Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function gmNewSwap(doc, employeeName) {
  return [
    '🔁 <b>New Swap Working Day request (GM)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    swapSummary(doc),
    '📌 Status: Waiting for GM approval',
    commentLine('Manager', doc?.managerComment),
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.gmInbox, 'Open GM Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function cooNewSwap(doc, employeeName) {
  return [
    '🔁 <b>New Swap Working Day request (COO)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    swapSummary(doc),
    '📌 Status: Waiting for COO approval',
    commentLine('Manager', doc?.managerComment),
    commentLine('GM', doc?.gmComment),
    reasonLine(doc),
    '',
    actionLinkLine(LINKS.cooInbox, 'Open COO Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeSubmitted(doc) {
  return [
    '✅ <b>Swap Working Day request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    swapSummary(doc),
    '📌 Status: Submitted',
    reasonLine(doc),
  ]
    .filter(Boolean)
    .join('\n')
}

function employeeDecision(doc, roleLabel) {
  const status = String(doc?.status || '').toUpperCase()
  const emoji = status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : status === 'CANCELLED' ? '🚫' : 'ℹ️'

  let extra = ''
  if (roleLabel === 'Manager') extra = commentLine('Manager', doc?.managerComment)
  if (roleLabel === 'GM') extra = commentLine('GM', doc?.gmComment)
  if (roleLabel === 'COO') extra = commentLine('COO', doc?.cooComment)

  return [
    `${emoji} <b>Swap request ${esc(status || 'UPDATED')} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    swapSummary(doc),
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  managerNewSwap,
  gmNewSwap,
  cooNewSwap,
  employeeSubmitted,
  employeeDecision,
}