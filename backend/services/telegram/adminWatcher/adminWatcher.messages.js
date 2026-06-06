/* eslint-disable no-console */
// backend/services/telegram/adminWatcher/adminWatcher.messages.js
// Message builder for immediate Leave Admin watcher alerts.

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://178.128.48.101:4333').replace(/\/$/, '')

const LINKS = {
  leaveAdmin: `${FRONTEND_URL}/leave/admin/report`,
  swapAdmin: `${FRONTEND_URL}/leave/admin/swap-day/report`,
  forgetScanAdmin: `${FRONTEND_URL}/leave/admin/forgetscan/report`,
}

function esc(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function ymd(v) {
  if (!v) return '?'
  const x = String(v)
  return x.length >= 10 ? x.slice(0, 10) : x
}

function n(v) {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function employeeName(doc) {
  return s(doc?.employeeName || doc?.name || doc?.fullName || doc?.employeeId || doc?.requesterLoginId || '—')
}

function employeeLine(doc) {
  const emp = employeeName(doc)
  const id = s(doc?.employeeId)
  return id && emp !== id ? `👤 Employee: <b>${esc(emp)}</b> (${esc(id)})` : `👤 Employee: <b>${esc(emp)}</b>`
}

function statusLabel(doc) {
  const st = up(doc?.status)
  if (st === 'PENDING_MANAGER') return 'Waiting for Manager approval'
  if (st === 'PENDING_GM') return 'Waiting for GM approval'
  if (st === 'PENDING_COO') return 'Waiting for COO approval'
  if (st === 'APPROVED') return 'Approved'
  if (st === 'REJECTED') return 'Rejected'
  if (st === 'CANCELLED' || st === 'CANCELED') return 'Cancelled'
  return st || 'Updated'
}

function eventTitle({ module, event }) {
  const mod = up(module)
  const ev = up(event)

  if (mod === 'LEAVE') {
    if (ev === 'SUBMITTED') return '🗓️ <b>Leave request submitted</b>'
    if (ev === 'STEP_APPROVED') return '👀 <b>Leave request progress</b>'
    if (ev === 'APPROVED_FINAL') return '✅ <b>Leave request final approved</b>'
    if (ev === 'REJECTED') return '❌ <b>Leave request rejected</b>'
    if (ev === 'CANCELLED') return '🚫 <b>Leave request cancelled</b>'
    return 'ℹ️ <b>Leave request updated</b>'
  }

  if (mod === 'SWAP') {
    if (ev === 'SUBMITTED') return '🔁 <b>Swap Working Day submitted</b>'
    if (ev === 'STEP_APPROVED') return '👀 <b>Swap Working Day progress</b>'
    if (ev === 'APPROVED_FINAL') return '✅ <b>Swap Working Day final approved</b>'
    if (ev === 'REJECTED') return '❌ <b>Swap Working Day rejected</b>'
    if (ev === 'CANCELLED') return '🚫 <b>Swap Working Day cancelled</b>'
    return 'ℹ️ <b>Swap Working Day updated</b>'
  }

  if (mod === 'FORGET_SCAN') {
    if (ev === 'SUBMITTED') return '🕘 <b>Forget Scan submitted</b>'
    if (ev === 'STEP_APPROVED') return '👀 <b>Forget Scan progress</b>'
    if (ev === 'APPROVED_FINAL') return '✅ <b>Forget Scan final approved</b>'
    if (ev === 'REJECTED') return '❌ <b>Forget Scan rejected</b>'
    if (ev === 'CANCELLED') return '🚫 <b>Forget Scan cancelled</b>'
    return 'ℹ️ <b>Forget Scan updated</b>'
  }

  return 'ℹ️ <b>Leave Admin update</b>'
}

function leaveSummary(doc) {
  const half = [
    doc?.startHalf ? `start:${doc.startHalf}` : '',
    doc?.endHalf ? `end:${doc.endHalf}` : '',
    doc?.isHalfDay && doc?.dayPart ? doc.dayPart : '',
  ]
    .filter(Boolean)
    .join(' ')

  return [
    `🏷️ Type: <b>${esc(doc?.leaveTypeCode || '-')}</b>`,
    `📅 Date: <b>${esc(ymd(doc?.startDate))} → ${esc(ymd(doc?.endDate || doc?.startDate))}</b>`,
    doc?.totalDays ? `🧮 Days: <b>${esc(String(doc.totalDays))}</b>` : '',
    half ? `🌓 Half: ${esc(half)}` : '',
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function swapSummary(doc) {
  const requestDays = n(doc?.requestTotalDays)
  const offDays = n(doc?.offTotalDays)

  return [
    `🧩 Work day: <b>${esc(ymd(doc?.requestStartDate))} → ${esc(ymd(doc?.requestEndDate || doc?.requestStartDate))}</b>${requestDays ? ` (${esc(String(requestDays))} day${requestDays === 1 ? '' : 's'})` : ''}`,
    `🏖️ Off day: <b>${esc(ymd(doc?.offStartDate))} → ${esc(ymd(doc?.offEndDate || doc?.offStartDate))}</b>${offDays ? ` (${esc(String(offDays))} day${offDays === 1 ? '' : 's'})` : ''}`,
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function forgetScanTypes(doc) {
  const arr = Array.isArray(doc?.forgotTypes) ? doc.forgotTypes : []
  const types = [...new Set(arr.map(up).filter(Boolean))]
  if (!types.length && doc?.forgotType) types.push(up(doc.forgotType))

  const hasIn = types.includes('FORGET_IN')
  const hasOut = types.includes('FORGET_OUT')
  if (hasIn && hasOut) return 'FORGET IN + FORGET OUT'
  if (hasIn) return 'FORGET IN'
  if (hasOut) return 'FORGET OUT'
  return types.join(', ') || '-'
}

function forgetScanSummary(doc) {
  return [
    `📅 Date: <b>${esc(ymd(doc?.forgotDate))}</b>`,
    `🧾 Type: <b>${esc(forgetScanTypes(doc))}</b>`,
    doc?.reason ? `📝 Reason: ${esc(doc.reason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function comments(doc) {
  return [
    doc?.managerComment ? `💬 Manager comment: ${esc(doc.managerComment)}` : '',
    doc?.gmComment ? `💬 GM comment: ${esc(doc.gmComment)}` : '',
    doc?.cooComment ? `💬 COO comment: ${esc(doc.cooComment)}` : '',
    doc?.rejectedReason ? `📝 Reject reason: ${esc(doc.rejectedReason)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function adminLink(module) {
  const mod = up(module)
  if (mod === 'LEAVE') return LINKS.leaveAdmin
  if (mod === 'SWAP') return LINKS.swapAdmin
  if (mod === 'FORGET_SCAN') return LINKS.forgetScanAdmin
  return ''
}

function moduleSummary(module, doc) {
  const mod = up(module)
  if (mod === 'LEAVE') return leaveSummary(doc)
  if (mod === 'SWAP') return swapSummary(doc)
  if (mod === 'FORGET_SCAN') return forgetScanSummary(doc)
  return ''
}

function watcherRequestMessage({ module, event, doc, actorLabel = '' }) {
  const title = eventTitle({ module, event })
  const link = adminLink(module)
  const by = s(actorLabel)
  const c = comments(doc)

  return [
    title,
    '━━━━━━━━━━━━━━━━━━━━',
    employeeLine(doc),
    moduleSummary(module, doc),
    `📌 Status: <b>${esc(statusLabel(doc))}</b>`,
    by ? `👤 By: <b>${esc(by)}</b>` : '',
    c,
    '',
    link ? `🔗 Admin view: ${esc(link)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  watcherRequestMessage,
}
