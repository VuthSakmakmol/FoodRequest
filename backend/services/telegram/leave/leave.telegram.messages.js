/* eslint-disable no-console */
// backend/services/telegram/leave/leave.telegram.messages.js
//
// ✅ Employee messages: friendly labels (NO PENDING_* codes shown)
// ✅ Approver messages: accurate waiting + (final) when applicable
// ✅ FYI/read-only:
//    - MANAGER_ONLY: GM gets FYI (read-only / acknowledge)
//    - GM_ONLY: COO gets FYI (read-only / acknowledge)
// ❌ Removed admin messages completely

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  managerInbox: `${FRONTEND_URL}/leave/requests/manager/inbox`,
  gmInbox: `${FRONTEND_URL}/leave/requests/gm/inbox`,
  cooInbox: `${FRONTEND_URL}/leave/requests/coo/inbox`,
}

function up(v) {
  return String(v ?? '').trim().toUpperCase()
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
  const sh = doc?.startHalf ? ` start:${doc.startHalf}` : ''
  const eh = doc?.endHalf ? ` end:${doc.endHalf}` : ''
  const legacy = doc?.isHalfDay && doc?.dayPart ? ` ${doc.dayPart}` : ''
  return sh || eh || legacy ? `🌓 Half: ${esc((sh + eh + legacy).trim())}` : ''
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

function isFinalApprover(mode, level) {
  const m = up(mode)
  const lvl = up(level)

  if (lvl === 'MANAGER') return m === 'MANAGER_ONLY'
  if (lvl === 'GM') return m === 'GM_ONLY' || m === 'MANAGER_AND_GM'
  if (lvl === 'COO') return m === 'COO_ONLY' || m === 'MANAGER_AND_COO' || m === 'GM_AND_COO'
  return false
}

/* ✅ Friendly status label for employees (NO internal codes) */
function friendlyEmployeeStatus(doc) {
  const st = up(doc?.status)
  if (st === 'PENDING_MANAGER') return 'Waiting for Manager approval'
  if (st === 'PENDING_GM') return 'Waiting for GM approval'
  if (st === 'PENDING_COO') return 'Waiting for COO approval'
  if (st === 'APPROVED') return 'Approved'
  if (st === 'REJECTED') return 'Rejected'
  if (st === 'CANCELLED') return 'Cancelled'
  return 'Updated'
}

/* ✅ For employee after a decision: what is the next step? */
function nextStepForEmployee(doc, decidedByRole) {
  const status = up(doc?.status)
  const mode = up(doc?.approvalMode)
  const by = up(decidedByRole)

  if (status === 'APPROVED' && isFinalApprover(mode, by)) return '🏁 Final approval completed.'
  if (status === 'REJECTED') return ''
  if (status === 'CANCELLED') return ''

  if (status === 'PENDING_MANAGER') return 'Next: Waiting for Manager approval'
  if (status === 'PENDING_GM') return 'Next: Waiting for GM approval'
  if (status === 'PENDING_COO') return 'Next: Waiting for COO approval'

  if (status === 'APPROVED') return '✅ Approved.'
  return ''
}

/* ─────────────────────────────
   Employee: created/submit confirm
───────────────────────────── */
function employeeSubmitted(doc) {
  return [
    '✅ <b>Leave request submitted</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    `📌 Status: <b>${esc(friendlyEmployeeStatus(doc))}</b>`,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
   Approver inbox: Manager (action)
───────────────────────────── */
function managerNew(doc, employeeName) {
  const mode = up(doc?.approvalMode)
  const note = isFinalApprover(mode, 'MANAGER')
    ? '📌 Status: Waiting for Manager approval (final)'
    : '📌 Status: Waiting for Manager approval'

  return [
    '🗓️ <b>New Leave request</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    note,
    '',
    actionLinkLine(LINKS.managerInbox, 'Open Manager Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
   Approver inbox: GM
   - action: for MANAGER_AND_GM / GM_ONLY / GM_AND_COO
   - FYI: for MANAGER_ONLY
───────────────────────────── */
function gmNew(doc, employeeName) {
  const mode = up(doc?.approvalMode)
  const isFyi = mode === 'MANAGER_ONLY'

  const note = isFyi
    ? [
        '👀 <b>FYI only (read-only)</b>',
        'No action required.',
        'Final approver: <b>Manager</b>.',
      ].join(' ')
    : isFinalApprover(mode, 'GM')
      ? '📌 Status: Waiting for GM approval (final)'
      : '📌 Status: Waiting for GM approval'

  return [
    isFyi ? '👀 <b>Leave request FYI (GM)</b>' : '🗓️ <b>New Leave request (GM)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    note,
    doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : '',
    '',
    actionLinkLine(LINKS.gmInbox, isFyi ? 'Open GM Inbox (view)' : 'Open GM Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
   Approver inbox: COO
   - action: for *_AND_COO / COO_ONLY
   - FYI: for GM_ONLY
───────────────────────────── */
function cooNew(doc, employeeName) {
  const mode = up(doc?.approvalMode)
  const isFyi = mode === 'GM_ONLY'

  const note = isFyi
    ? [
        '👀 <b>FYI only (read-only)</b>',
        'No action required.',
        'Final approver: <b>GM</b>.',
      ].join(' ')
    : isFinalApprover(mode, 'COO')
      ? '📌 Status: Waiting for COO approval (final)'
      : '📌 Status: Waiting for COO approval'

  return [
    isFyi ? '👀 <b>Leave request FYI (COO)</b>' : '🗓️ <b>New Leave request (COO)</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLabel(doc, employeeName),
    summary(doc),
    note,
    doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : '',
    doc?.gmComment ? `💬 GM comment: ${esc(doc.gmComment)}` : '',
    '',
    actionLinkLine(LINKS.cooInbox, isFyi ? 'Open COO Inbox (view)' : 'Open COO Inbox'),
  ]
    .filter(Boolean)
    .join('\n')
}

/* ─────────────────────────────
   Employee: decision messages (friendly + next step)
───────────────────────────── */
function employeeDecision(doc, roleLabel) {
  const status = up(doc?.status)
  const emoji =
    status === 'APPROVED' ? '✅' : status === 'REJECTED' ? '❌' : status === 'CANCELLED' ? '🚫' : 'ℹ️'

  let extra = ''
  if (roleLabel === 'Manager' && doc?.managerComment) extra = `💬 Manager comment: ${esc(doc.managerComment)}`
  if (roleLabel === 'GM' && doc?.gmComment) extra = `💬 GM comment: ${esc(doc.gmComment)}`
  if (roleLabel === 'COO' && doc?.cooComment) extra = `💬 COO comment: ${esc(doc.cooComment)}`

  const next = nextStepForEmployee(doc, roleLabel)

  const titleStatus =
    status === 'APPROVED'
      ? 'Approved'
      : status === 'REJECTED'
        ? 'Rejected'
        : status === 'CANCELLED'
          ? 'Cancelled'
          : 'Updated'

  return [
    `${emoji} <b>Leave request ${esc(titleStatus)} by ${esc(roleLabel)}</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    summary(doc),
    next ? esc(next) : '',
    extra,
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
}