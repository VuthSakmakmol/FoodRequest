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

function employeeLine(doc, employeeName) {
  const label = employeeName || doc.employeeName || doc.employeeId || doc.requesterLoginId || 'Employee'
  return `👤 Employee: <b>${esc(label)}</b>`
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

function waitingRole(doc) {
  const st = up(doc?.status)
  if (st === 'PENDING_MANAGER') return 'Manager'
  if (st === 'PENDING_GM') return 'GM'
  if (st === 'PENDING_COO') return 'COO'
  return ''
}

function inboxLinkForStatus(doc) {
  const st = up(doc?.status)
  if (st === 'PENDING_MANAGER') return LINKS.managerInbox
  if (st === 'PENDING_GM') return LINKS.gmInbox
  if (st === 'PENDING_COO') return LINKS.cooInbox
  return ''
}

/* ───────── Employee submit confirmation ───────── */
function employeeSubmitted(doc) {
  const role = waitingRole(doc)
  return [
    '✅ <b>Forget Scan request submitted</b>',
    '━━━━━━━━━━━━━━━━━━',
    summary(doc),
    role ? `📌 Waiting for <b>${esc(role)}</b> approval` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/* ───────── NEW: Employee step approved but still waiting next approver ───────── */
function employeeWaitingNextApprover(doc, actedByLabel, nextApproverLabel) {
  return [
    '✅ <b>Forget Scan update</b>',
    '━━━━━━━━━━━━━━━━━━',
    summary(doc),
    actedByLabel ? `👤 Approved by: <b>${esc(actedByLabel)}</b>` : '',
    nextApproverLabel ? `⏳ Waiting for <b>${esc(nextApproverLabel)}</b> final approval.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/* ───────── Approver message (action required) ───────── */
function approverNew(doc, employeeName, roleLabel) {
  const link = inboxLinkForStatus(doc)
  return [
    '🕘 <b>Forget Scan approval needed</b>',
    '━━━━━━━━━━━━━━━━━━',
    employeeLine(doc, employeeName),
    summary(doc),
    '',
    `📌 Action required: <b>Approve or Reject</b>`,
    roleLabel ? `👤 Your Role: <b>${esc(roleLabel)}</b>` : '',
    '',
    link ? `🔗 Open inbox:\n${esc(link)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/* ───────── FYI / Read-only message (NO ACTION) ───────── */
function fyiNew(doc, employeeName, toRoleLabel, waitingForLabel) {
  return [
    `ℹ️ <b>FYI: Forget Scan request</b>`,
    '━━━━━━━━━━━━━━━━━━',
    employeeLine(doc, employeeName),
    summary(doc),
    '',
    waitingForLabel ? `📌 Status: Waiting for <b>${esc(waitingForLabel)}</b> approval` : '',
    `✅ Note: No action required for <b>${esc(toRoleLabel)}</b> (read-only).`,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ───────── Employee update after final decision/cancel ───────── */
function employeeDecision(doc, roleLabel) {
  const status = up(doc?.status)
  let emoji = 'ℹ️'
  if (status === 'APPROVED') emoji = '✅'
  if (status === 'REJECTED') emoji = '❌'
  if (status === 'CANCELLED') emoji = '🚫'

  let result = ''
  if (status === 'APPROVED') result = 'Approved'
  if (status === 'REJECTED') result = 'Rejected'
  if (status === 'CANCELLED') result = 'Cancelled'

  const extra =
    status === 'REJECTED'
      ? doc?.rejectedReason
        ? `📝 Reason: ${esc(doc.rejectedReason)}`
        : ''
      : ''

  return [
    `${emoji} <b>Forget Scan update</b>`,
    '━━━━━━━━━━━━━━━━━━',
    summary(doc),
    result ? `📌 Result: <b>${esc(result)}</b>` : '',
    roleLabel ? `👤 By: <b>${esc(roleLabel)}</b>` : '',
    extra,
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  employeeSubmitted,
  employeeWaitingNextApprover, // ✅ export
  approverNew,
  fyiNew,
  employeeDecision,
}