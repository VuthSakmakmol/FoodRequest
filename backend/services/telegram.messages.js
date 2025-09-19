// backend/services/telegram.messages.js
const dayjs = require('dayjs')

/* ───────── helpers ───────── */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—')
const fmtBool = v => (v ? 'Yes' : 'No')
const joinOrDash = arr => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—')

function timeRange(d, start, end) {
  const base = fmtDate(d)
  const s = start ? esc(start) : ''
  const e = end ? esc(end) : ''
  if (s && e) return `${base} ${s} – ${e}`
  if (s) return `${base} ${s}`
  if (e) return `${base} – ${e}`
  return base
}

function linesForRecurring(recurring = {}) {
  const r = recurring || {}
  const out = []
  out.push(`🔁 Recurring: <b>${fmtBool(!!r.enabled)}</b>`)
  if (r.enabled) {
    out.push(`• Frequency: ${esc(r.frequency || '—')}`)
    out.push(`• End date: ${fmtDate(r.endDate)}`)
    out.push(`• Skip holidays: ${fmtBool(!!r.skipHolidays)}`)
  }
  return out
}

function linesForStatusHistory(list = [], limit = 4) {
  if (!Array.isArray(list) || list.length === 0) return []
  const last = list.slice(-limit)
  const rows = last.map(
    x => `• ${esc(x.status)} @ ${fmtDateTime(x.at)}${x.by ? ` by ${esc(x.by)}` : ''}`
  )
  return ['📜 History:', ...rows]
}

function linesForStepDates(stepDates = {}) {
  if (!stepDates) return []
  const map = [
    ['newAt', 'NEW'],
    ['acceptedAt', 'ACCEPTED'],
    ['cookingAt', 'COOKING'],
    ['readyAt', 'READY'],
    ['deliveredAt', 'DELIVERED'],
    ['canceledAt', 'CANCELED'],
  ]
  const rows = map
    .filter(([k]) => stepDates[k])
    .map(([k, label]) => `• ${label}: ${fmtDateTime(stepDates[k])}`)
  return rows.length ? ['⏱️ Timestamps:', ...rows] : []
}

function safeNote(s, max = 600) {
  if (!s) return null
  const t = String(s)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// 🔹 Pretty-print counts
function formatCounts(obj = {}) {
  if (!obj || typeof obj !== 'object') return '—'
  const entries = Object.entries(obj)
    .filter(([_, v]) => v && Number(v) > 0)
    .map(([k, v]) => `${k}: ${v}`)
  return entries.length ? entries.join(', ') : '—'
}

/* ───────── message builders ───────── */
function baseInfo(doc) {
  const d = doc || {}
  const emp = d.employee || {}
  const loc = d.location || {}

  return [
    `📌 Request ID: <code>${esc(d.requestId || d._id || '')}</code>`,
    `👤 Employee: <b>${esc(emp.name || '')}</b> (${esc(emp.employeeId || '')})`,
    `🏢 Department: ${esc(emp.department || '')}`,
    `📅 Order Date: ${fmtDate(d.orderDate)}`,
    `📅 Eat Date: ${fmtDate(d.eatDate)}`,
    `⏰ Time: ${esc(d.eatTimeStart || '')} – ${esc(d.eatTimeEnd || '')}`,
    `📋 Order Type: ${esc(d.orderType || '')}`,
    `🥗 Meals: ${esc(joinOrDash(d.meals))}`,
    `👥 Quantity: ${esc(d.quantity ?? '')}`,
    `🏠 Location: ${esc(loc.kind || '')}${loc.kind === 'Other' && loc.other ? ` (${esc(loc.other)})` : ''}`,
    `📦 Menu Choices: ${esc(joinOrDash(d.menuChoices))}`,
    `🍱 Menu Counts: ${formatCounts(d.menuCounts)}`,
    `⚠️ Dietary: ${esc(joinOrDash(d.dietary))}`,
    `⚠️ Dietary Counts: ${formatCounts(d.dietaryCounts)}`,
    d.dietaryOther ? `📝 Dietary Other: ${esc(d.dietaryOther)}` : null,
    d.specialInstructions ? `📝 Note: ${esc(safeNote(d.specialInstructions))}` : null,
  ].filter(Boolean)
}

function newRequestMsg(doc) {
  return [
    '🍽️ <b>New Food Request</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    ...linesForRecurring(doc.recurring || {}),
    '-----------------------------',
    `📊 Status: <b>${esc(doc.status || 'NEW')}</b>`,
    ...linesForStatusHistory(doc.statusHistory, 4),
    ...linesForStepDates(doc.stepDates),
  ].filter(Boolean).join('\n')
}

function acceptedMsg(doc) {
  return [
    '✅ <b>Request Accepted</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Status: <b>ACCEPTED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 6),
    ...linesForStepDates(doc.stepDates),
  ].filter(Boolean).join('\n')
}

function deliveredMsg(doc) {
  return [
    '📦 <b>Request Delivered</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Final status: <b>DELIVERED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 6),
    ...linesForStepDates(doc.stepDates),
  ].filter(Boolean).join('\n')
}

function cancelMsg(doc) {
  return [
    '❌ <b>Request Canceled</b>',
    '=============================',
    ...baseInfo(doc),
    doc.cancelReason ? `🚫 Reason: ${esc(doc.cancelReason)}` : '🚫 Reason: —',
    '-----------------------------',
    `📊 Final status: <b>CANCELED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 6),
    ...linesForStepDates(doc.stepDates),
  ].filter(Boolean).join('\n')
}

module.exports = {
  newRequestMsg,
  acceptedMsg,
  deliveredMsg,
  cancelMsg,
}
