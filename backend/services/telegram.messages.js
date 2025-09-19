// backend/services/telegram.messages.js
const dayjs = require('dayjs');

/* ───────── helpers ───────── */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—');
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—');
const fmtBool = v => (v ? 'Yes' : 'No');
const joinOrDash = arr => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—');

function timeRange(d, start, end) {
  const base = fmtDate(d);
  const s = start ? esc(start) : '';
  const e = end ? esc(end) : '';
  if (s && e) return `${base} ${s} – ${e}`;
  if (s) return `${base} ${s}`;
  if (e) return `${base} – ${e}`;
  return base;
}

function linesForRecurring(recurring = {}) {
  const r = recurring || {};
  const out = [];
  out.push(`Recurring: <b>${fmtBool(!!r.enabled)}</b>`);
  if (r.enabled) {
    out.push(`• Frequency: ${esc(r.frequency || '—')}`);
    out.push(`• End date: ${fmtDate(r.endDate)}`);
    out.push(`• Skip holidays: ${fmtBool(!!r.skipHolidays)}`);
  }
  return out;
}

function linesForStatusHistory(list = [], limit = 4) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const last = list.slice(-limit);
  const rows = last.map(x => `• ${esc(x.status)} @ ${fmtDateTime(x.at)}${x.by ? ` by ${esc(x.by)}` : ''}`);
  return ['History:', ...rows];
}

function linesForStepDates(stepDates = {}) {
  if (!stepDates) return [];
  const map = [
    ['newAt', 'NEW'],
    ['acceptedAt', 'ACCEPTED'],
    ['cookingAt', 'COOKING'],
    ['readyAt', 'READY'],
    ['deliveredAt', 'DELIVERED'],
    ['canceledAt', 'CANCELED'],
  ];
  const rows = map
    .filter(([k]) => stepDates[k])
    .map(([k, label]) => `• ${label}: ${fmtDateTime(stepDates[k])}`);
  return rows.length ? ['Timestamps:', ...rows] : [];
}

function safeNote(s, max = 600) {
  if (!s) return null;
  const t = String(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/* ───────── message builders ───────── */
function newRequestMsg(doc) {
  const d = doc || {};
  const emp = d.employee || {};
  const loc = d.location || {};
  const serve = timeRange(d.serveDate, d.timeStart, d.timeEnd);

  const note = safeNote(d.specialInstructions);

  const parts = [
    '🍽️ <b>New Food Request</b>',
    '----------------------------',
    `Employee ID: <code>${esc(emp.employeeId || '')}</code>`,
    `Request ID: <code>${esc(d.requestId || d._id || '')}</code>`,
    `From: <b>${esc(emp.name || '')}</b> (${esc(emp.department || '')})`,
    `Type: ${esc(d.orderType || '')} | Menu: ${esc(d.menuType || '')}`,
    `Meals: ${esc(joinOrDash(d.meals))}`,
    `Qty: ${esc(d.quantity ?? '')} | Serve: ${esc(serve)}`,
    `Location: ${esc(loc.kind || '')}${loc.kind === 'Other' && loc.other ? ` (${esc(loc.other)})` : ''}`,
    `Dietary: ${esc(joinOrDash(d.dietary))}`,
    d.dietaryOther ? `Dietary other: ${esc(d.dietaryOther)}` : null,
    note ? `Note: ${esc(note)}` : null,
    '------------------------------ ',
    ...linesForRecurring(d.recurring || {}),
    '------------------------------ ',
    `Status: <b>${esc(d.status || 'NEW')}</b>`,
    ...linesForStatusHistory(d.statusHistory, 4),
    ...linesForStepDates(d.stepDates),
  ].filter(Boolean);

  return parts.join('\n');
}

function deliveredMsg(doc) {
  const d = doc || {};
  const emp = d.employee || {};
  const serve = timeRange(d.serveDate, d.timeStart, d.timeEnd);

  const parts = [
    '✅ <b>Request Delivered</b>',
    `Employee ID: <code>${esc(emp.employeeId || '')}</code>`,
    `Request ID: <code>${esc(d.requestId || d._id || '')}</code>`,
    `To: <b>${esc(emp.name || '')}</b> (${esc(emp.department || '')})`,
    `Serve: ${esc(serve)}`,
    `Meals: ${esc(joinOrDash(d.meals))}`,
    '',
    'Final status: <b>DELIVERED</b>',
    ...linesForStatusHistory(d.statusHistory, 6),
    ...linesForStepDates(d.stepDates),
  ].filter(Boolean);

  return parts.join('\n');
}

function cancelMsg(doc) {
  const d = doc || {};
  const emp = d.employee || {};
  const serve = timeRange(d.serveDate, d.timeStart, d.timeEnd);

  const parts = [
    '❌ <b>Request Canceled</b>',
    `Employee ID: <code>${esc(emp.employeeId || '')}</code>`,
    `Request ID: <code>${esc(d.requestId || d._id || '')}</code>`,
    `From: <b>${esc(emp.name || '')}</b> (${esc(emp.department || '')})`,
    `Serve: ${esc(serve)}`,
    `Meals: ${esc(joinOrDash(d.meals))}`,
    d.cancelReason ? `Reason: ${esc(d.cancelReason)}` : 'Reason: —',
    '',
    'Final status: <b>CANCELED</b>',
    ...linesForStatusHistory(d.statusHistory, 6),
    ...linesForStepDates(d.stepDates),
  ].filter(Boolean);

  return parts.join('\n');
}

module.exports = {
  newRequestMsg,
  deliveredMsg,
  cancelMsg,
};
