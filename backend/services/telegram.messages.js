// backend/services/telegram.messages.js
const dayjs = require('dayjs')

/* ───────── helpers ───────── */
function esc(s = '') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
// kept in case used by history; remove if you later decide to strip times from history too
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—')
const fmtBool = v => (v ? 'Yes' : 'No')
const joinOrDash = arr => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—')
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const toInt = v => (v == null ? 0 : Number(v) || 0)

function safeNote(s, max = 600) { if (!s) return null; const t = String(s); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

/* ───────── counts logic (supports array OR object) ───────── */
function menuMap(doc) {
  const out = new Map()
  const src = doc?.menuCounts

  if (Array.isArray(src)) {
    for (const it of src) {
      const choice = it?.choice
      const cnt = toInt(it?.count)
      if (!choice || !cnt) continue
      out.set(choice, (out.get(choice) || 0) + cnt)
    }
  } else if (isObj(src)) {
    for (const [choice, val] of Object.entries(src)) {
      const cnt = isObj(val) ? toInt(val.count) : toInt(val)
      if (!choice || !cnt) continue
      out.set(choice, (out.get(choice) || 0) + cnt)
    }
  }

  // derive Standard if not present (legacy)
  if (!out.has('Standard')) {
    const nonStd = Array.from(out.values()).reduce((s, v) => s + toInt(v), 0)
    const std = Math.max(toInt(doc?.quantity) - nonStd, 0)
    if (std > 0) out.set('Standard', std)
  }

  for (const [k, v] of out.entries()) if (!toInt(v)) out.delete(k)
  return out
}

function dietaryByMenu(doc) {
  const out = new Map()
  const src = doc?.dietaryCounts

  if (Array.isArray(src)) {
    for (const it of src) {
      const menu = it?.menu || 'Standard'
      const allergen = it?.allergen
      const cnt = toInt(it?.count)
      if (!allergen || !cnt) continue
      if (!out.has(menu)) out.set(menu, new Map())
      const inner = out.get(menu)
      inner.set(allergen, (inner.get(allergen) || 0) + cnt)
    }
  } else if (isObj(src)) {
    for (const [menu, innerObj] of Object.entries(src)) {
      if (!isObj(innerObj)) continue
      for (const [allergen, val] of Object.entries(innerObj)) {
        const cnt = isObj(val) ? toInt(val.count) : toInt(val)
        if (!allergen || !cnt) continue
        const m = menu || 'Standard'
        if (!out.has(m)) out.set(m, new Map())
        const inner = out.get(m)
        inner.set(allergen, (inner.get(allergen) || 0) + cnt)
      }
    }
  }

  for (const [k, inner] of out.entries()) if (!inner?.size) out.delete(k)
  return out
}

/* ───────── pretty sections ───────── */
function linesForMenuCounts(doc) {
  const m = menuMap(doc)
  if (!m.size) return ['🍱 Menu Counts: —']
  const lines = ['🍱 Menu Counts:']
  const ordered = Array.from(m.entries()).sort(
    (a, b) => (a[0] === 'Standard' ? -1 : b[0] === 'Standard' ? 1 : a[0].localeCompare(b[0]))
  )
  let total = 0
  for (const [choice, cnt] of ordered) {
    total += toInt(cnt)
    lines.push(`• ${esc(choice)} × <b>${toInt(cnt)}</b>`)
  }
  lines.push(`• <i>Total menus</i>: <b>${total}</b>`)
  // NOTE: "Δ vs quantity" intentionally removed
  return lines
}

function linesForDietaryCounts(doc) {
  const g = dietaryByMenu(doc)
  if (!g.size) {
    const base = [`⚠️ Dietary: ${esc(joinOrDash(doc?.dietary))}`]
    if (doc?.dietaryOther) base.push(`• Other: ${esc(doc.dietaryOther)}`)
    base.push('⚠️ Dietary Counts: —')
    return base
  }
  const lines = ['⚠️ Dietary Counts (by menu):']
  const orderedMenus = Array.from(g.keys()).sort(
    (a, b) => (a === 'Standard' ? -1 : b === 'Standard' ? 1 : a.localeCompare(b))
  )
  for (const menu of orderedMenus) {
    const inner = g.get(menu)
    const parts = Array.from(inner.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([allergen, cnt]) => `${esc(allergen)} × <b>${toInt(cnt)}</b>`)
    const sum = Array.from(inner.values()).reduce((s, v) => s + toInt(v), 0)
    lines.push(`• ${esc(menu)} — ${parts.join(', ')} (sum: <b>${sum}</b>)`)
  }
  if (doc?.dietaryOther) lines.push(`• Other: ${esc(doc.dietaryOther)}`)
  return lines
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

function linesForStatusHistory(list = [], limit = 6) {
  if (!Array.isArray(list) || list.length === 0) return []
  const last = list.slice(-limit)
  const rows = last.map(x => `• ${esc(x.status)} @ ${fmtDateTime(x.at)}${x.by ? ` by ${esc(x.by)}` : ''}`)
  return ['📜 History:', ...rows]
}

/* ───────── base info + builders ───────── */
function baseInfo(doc) {
  const d = doc || {}
  const emp = d.employee || {}
  const loc = d.location || {}
  const lines = [
    `📌 Request ID: <code>${esc(d.requestId || d._id || '')}</code>`,
    `👤 Employee: <b>${esc(emp.name || '')}</b>${emp.employeeId ? ` (${esc(emp.employeeId)})` : ''}`,
    `🏢 Department: ${esc(emp.department || '')}`,
    `📅 Order Date: ${fmtDate(d.orderDate)}`,
    `📅 Eat Date: ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ Time: ${d.eatTimeStart ? esc(d.eatTimeStart) : '–'}${d.eatTimeEnd ? ` – ${esc(d.eatTimeEnd)}` : ''}`,
    `📋 Order Type: ${esc(d.orderType || '')}`,
    `🥗 Meals: ${esc(joinOrDash(d.meals))}`,
    `👥 Quantity: <b>${toInt(d.quantity)}</b>`,
    `🏠 Location: ${esc(loc.kind || '')}${loc.kind === 'Other' && loc.other ? ` (${esc(loc.other)})` : ''}`,
    `📦 Menu Choices: ${esc(joinOrDash(d.menuChoices))}`,
    '-----------------------------',
    ...linesForMenuCounts(d),
    '-----------------------------',
    ...linesForDietaryCounts(d),
  ]
  const notes = []
  if (d.specialInstructions) notes.push(`📝 Note: ${esc(safeNote(d.specialInstructions))}`)
  if (d.cancelReason) notes.push(`🚫 Cancel Reason: ${esc(d.cancelReason)}`)
  if (notes.length) lines.push('-----------------------------', ...notes)
  return lines
}

/* ───────── per-step messages (all steps covered) ───────── */
function newRequestMsg(doc) {
  return [
    '🍽️ <b>New Food Request</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    ...linesForRecurring(doc.recurring || {}),
    '-----------------------------',
    `📊 Status: <b>${esc(doc.status || 'NEW')}</b>`,
    ...linesForStatusHistory(doc.statusHistory, 6),
  ].filter(Boolean).join('\n')
}

function acceptedMsg(doc) {
  return [
    '✅ <b>Request Accepted</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    '📊 Status: <b>ACCEPTED</b>',
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function cookingMsg(doc) {
  return [
    '👨‍🍳 <b>Cooking Started</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    '📊 Status: <b>COOKING</b>',
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function readyMsg(doc) {
  return [
    '🟢 <b>Order Ready</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    '📊 Status: <b>READY</b>',
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function deliveredMsg(doc) {
  return [
    '📦 <b>Request Delivered</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    '📊 Final status: <b>DELIVERED</b>',
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function cancelMsg(doc) {
  return [
    '❌ <b>Request Canceled</b>',
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    '📊 Final status: <b>CANCELED</b>',
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

/* ───────── dispatcher (use this to alert “all steps”) ───────── */
function statusUpdateMsg(doc) {
  const s = (doc?.status || 'NEW').toUpperCase()
  switch (s) {
    case 'NEW': return newRequestMsg(doc)
    case 'ACCEPTED': return acceptedMsg(doc)
    case 'COOKING': return cookingMsg(doc)
    case 'READY': return readyMsg(doc)
    case 'DELIVERED': return deliveredMsg(doc)
    case 'CANCELED': return cancelMsg(doc)
    default: return [
      `ℹ️ <b>Status Updated</b> → <b>${esc(s)}</b>`,
      '=============================',
      ...baseInfo(doc),
      '-----------------------------',
      `📊 Status: <b>${esc(s)}</b>`,
      ...linesForStatusHistory(doc.statusHistory, 6),
    ].filter(Boolean).join('\n')
  }
}

module.exports = {
  newRequestMsg,
  acceptedMsg,
  cookingMsg,
  readyMsg,
  deliveredMsg,
  cancelMsg,
  statusUpdateMsg,
}
