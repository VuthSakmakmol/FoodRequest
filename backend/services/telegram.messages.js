// backend/services/telegram.messages.js
const dayjs = require('dayjs')

/* ───────── helpers ───────── */
function esc(s = '') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—')
const fmtBool = v => (v ? 'Yes' : 'No')
const joinOrDash = arr => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—')
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const toInt = v => (v == null ? 0 : Number(v) || 0)

function safeNote(s, max = 600) {
  if (!s) return null
  const t = String(s)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/* ───────── base maps for KH display ───────── */
const ORDER_TYPE_KH = {
  'Daily meal': 'អាហារប្រចាំថ្ងៃ',
  'Meeting catering': 'សេវាអាហារសម្រាប់ការប្រជុំ',
  'Visitor meal': 'អាហារសម្រាប់ភ្ញៀវ',
}

const MEAL_KH = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់',
}

const MENU_KH = {
  Standard: 'អាហារធម្មតា',
  Vegetarian: 'អាហារមិនមានសាច់',
  Vegan: 'អាហារបួស',
  'No pork': 'អាហារគ្មានសាច់ជ្រូក',
  'No beef': 'អាហារគ្មានសាច់គោ',
}

const ALLERGEN_KH = {
  Peanut: 'សណ្តែកដី',
  Shellfish: 'អាហារសមុទ្រ / សត្វសំបក',
  Egg: 'ស៊ុត',
  Gluten: 'ក្លុយតែន (ម្សៅមី)',
  'Dairy/Lactose': 'ទឹកដោះគោ / ឡាក់តូស',
  Soy: 'សណ្ដែក',
  Others: 'ផ្សេងៗ',
}

const LOCATION_KH = {
  'Meeting Room': 'បន្ទប់ប្រជុំ',
  Canteen: 'កង់ទីន',
  Other: 'ទីតាំងផ្សេងៗ',
}

const RECUR_FREQ_KH = {
  Daily: 'រៀងរាល់ថ្ងៃ',
  Weekly: 'រៀងរាល់សប្ដាហ៍',
  Monthly: 'រៀងរាល់ខែ',
}

/* ───────── status icons (big colored circles) ───────── */
const STATUS_ICON = {
  NEW: '🟢',        // green
  ACCEPTED: '🟡',   // yellow
  COOKING: '🔵',    // blue
  READY: '🟣',      // purple
  DELIVERED: '⚪',  // white
  CANCELED: '🔴',   // red
}

function iconFor(status) {
  const key = String(status || 'NEW').toUpperCase()
  return STATUS_ICON[key] || '🔘'
}

/* helper mappers */
const mapOne = (val, dict) => (val && dict[val]) || val || ''
const mapArray = (arr, dict) =>
  Array.isArray(arr) && arr.length
    ? arr.map(v => mapOne(v, dict)).join(', ')
    : '—'

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

/* ───────── EN: pretty sections ───────── */
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
  const rows = last.map(
    x => `• ${esc(x.status)} @ ${fmtDateTime(x.at)}${x.by ? ` by ${esc(x.by)}` : ''}`
  )
  return ['📜 History:', ...rows]
}

/* ───────── EN: base info for group ───────── */
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

/* ───────── KH: pretty sections for Chef DMs ───────── */
function linesForMenuCountsKh(doc) {
  const m = menuMap(doc)
  if (!m.size) return ['🍱 ចំនួនម៉ឺនុយ៖ —']
  const lines = ['🍱 ចំនួនម៉ឺនុយ៖']
  const ordered = Array.from(m.entries()).sort(
    (a, b) => (a[0] === 'Standard' ? -1 : b[0] === 'Standard' ? 1 : a[0].localeCompare(b[0]))
  )
  let total = 0
  for (const [choice, cnt] of ordered) {
    total += toInt(cnt)
    const label = mapOne(choice, MENU_KH)
    lines.push(`• ${esc(label)} × <b>${toInt(cnt)}</b>`)
  }
  lines.push(`• <i>សរុបម៉ឺនុយ</i>៖ <b>${total}</b>`)
  return lines
}

function linesForDietaryCountsKh(doc) {
  const g = dietaryByMenu(doc)
  if (!g.size) {
    const dietaryLabel = Array.isArray(doc?.dietary)
      ? mapArray(doc.dietary, ALLERGEN_KH)
      : '—'
    const base = [`⚠️ អាឡែស៊ី៖ ${esc(dietaryLabel)}`]
    if (doc?.dietaryOther) base.push(`• ផ្សេងៗ៖ ${esc(doc.dietaryOther)}`)
    base.push('⚠️ ចំនួនអាហារផ្សេងៗ៖ —')
    return base
  }
  const lines = ['⚠️ ចំនួនអាហារផ្សេងៗ (តាមម៉ឺនុយ)៖']
  const orderedMenus = Array.from(g.keys()).sort(
    (a, b) => (a === 'Standard' ? -1 : b === 'Standard' ? 1 : a.localeCompare(b))
  )
  for (const menu of orderedMenus) {
    const inner = g.get(menu)
    const parts = Array.from(inner.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([allergen, cnt]) => {
        const label = mapOne(allergen, ALLERGEN_KH)
        return `${esc(label)} × <b>${toInt(cnt)}</b>`
      })
    const sum = Array.from(inner.values()).reduce((s, v) => s + toInt(v), 0)
    const menuLabel = mapOne(menu, MENU_KH)
    lines.push(`• ${esc(menuLabel)} — ${parts.join(', ')} (សរុប៖ <b>${sum}</b>)`)
  }
  if (doc?.dietaryOther) lines.push(`• ផ្សេងៗ៖ ${esc(doc.dietaryOther)}`)
  return lines
}

/* KH: recurring (for chef) */
function linesForRecurringKh(recurring = {}) {
  const r = recurring || {}
  const out = []
  out.push(`🔁 កម្មង់ច្រើនថ្ងៃ៖ <b>${r.enabled ? 'បើក' : 'បិទ'}</b>`)
  if (r.enabled) {
    const freqLabel = mapOne(r.frequency, RECUR_FREQ_KH)
    out.push(`• កម្រិតធ្វើម្ដងៗ៖ ${esc(freqLabel || '—')}`)
    out.push(`• កាលបរិច្ឆេទបញ្ចប់៖ ${fmtDate(r.endDate)}`)
    out.push(`• ត្រូវអាហារថ្ងៃឈប់សម្រាក៖ ${r.skipHolidays ? 'បាទ/ចាស' : 'ទេ'}`)
  }
  return out
}

/* ───────── KH: base info for Chef DMs ───────── */
function baseInfoKh(doc) {
  const d = doc || {}
  const emp = d.employee || {}
  const loc = d.location || {}

  const orderTypeKh = mapOne(d.orderType, ORDER_TYPE_KH)
  const mealsKh = mapArray(d.meals, MEAL_KH)
  const locKindKh = loc.kind ? mapOne(loc.kind, LOCATION_KH) : ''
  const locStr = locKindKh || loc.kind || ''

  const lines = [
    `📌 លេខសំណើ៖ <code>${esc(d.requestId || d._id || '')}</code>`,
    `👤 និយោជិក៖ <b>${esc(emp.name || '')}</b>${emp.employeeId ? ` (${esc(emp.employeeId)})` : ''}`,
    `🏢 ផ្នែក៖ ${esc(emp.department || '')}`,
    `📅 កាលបរិច្ឆេទកម្មង់៖ ${fmtDate(d.orderDate)}`,
    `📅 កាលបរិច្ឆេទបរិភោគ៖ ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ ម៉ោង៖ ${d.eatTimeStart ? esc(d.eatTimeStart) : '–'}${d.eatTimeEnd ? ` – ${esc(d.eatTimeEnd)}` : ''}`,
    `📋 ប្រភេទកម្មង់៖ ${esc(orderTypeKh || d.orderType || '')}`,
    `🥗 មុខអាហារ៖ ${esc(mealsKh)}`,
    `👥 ចំនួនមនុស្ស៖ <b>${toInt(d.quantity)}</b>`,
    `🏠 ទីតាំង៖ ${esc(locStr)}${loc.kind === 'Other' && loc.other ? ` (${esc(loc.other)})` : ''}`,
    `📦 ជម្រើសម៉ឺនុយ៖ ${esc(mapArray(d.menuChoices, MENU_KH))}`,
    '-----------------------------',
    ...linesForMenuCountsKh(d),
    '-----------------------------',
    ...linesForDietaryCountsKh(d),
  ]
  const notes = []
  if (d.specialInstructions) notes.push(`📝 កំណត់ចំណាំ៖ ${esc(safeNote(d.specialInstructions))}`)
  if (d.cancelReason) notes.push(`🚫 មូលហេតុបោះបង់៖ ${esc(d.cancelReason)}`)
  if (notes.length) lines.push('-----------------------------', ...notes)
  return lines
}

/* ───────── EN: per-step messages (group) ───────── */
function newRequestMsg(doc) {
  const icon = iconFor(doc.status || 'NEW')
  return [
    `${icon} <b>New Food Request</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>${esc(doc.status || 'NEW')}</b>`,
    ...linesForStatusHistory(doc.statusHistory, 6),
  ].filter(Boolean).join('\n')
}

function acceptedMsg(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>Request Accepted</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>ACCEPTED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function cookingMsg(doc) {
  const icon = iconFor('COOKING')
  return [
    `${icon} <b>Cooking Started</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>COOKING</b>`,
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function readyMsg(doc) {
  const icon = iconFor('READY')
  return [
    `${icon} <b>Order Ready</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>READY</b>`,
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function deliveredMsg(doc) {
  const icon = iconFor('DELIVERED')
  return [
    `${icon} <b>Request Delivered</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Final status: ${icon} <b>DELIVERED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

function cancelMsg(doc) {
  const icon = iconFor('CANCELED')
  return [
    `${icon} <b>Request Canceled</b>`,
    '=============================',
    ...baseInfo(doc),
    '-----------------------------',
    `📊 Final status: ${icon} <b>CANCELED</b>`,
    ...linesForStatusHistory(doc.statusHistory, 8),
  ].filter(Boolean).join('\n')
}

/* ───────── EN: dispatcher (generic) ───────── */
function statusUpdateMsg(doc) {
  const s = (doc?.status || 'NEW').toUpperCase()
  const icon = iconFor(s)
  switch (s) {
    case 'NEW': return newRequestMsg(doc)
    case 'ACCEPTED': return acceptedMsg(doc)
    case 'COOKING': return cookingMsg(doc)
    case 'READY': return readyMsg(doc)
    case 'DELIVERED': return deliveredMsg(doc)
    case 'CANCELED': return cancelMsg(doc)
    default: return [
      `${icon} <b>Status Updated</b> → <b>${esc(s)}</b>`,
      '=============================',
      ...baseInfo(doc),
      '-----------------------------',
      `📊 Status: ${icon} <b>${esc(s)}</b>`,
      ...linesForStatusHistory(doc.statusHistory, 6),
    ].filter(Boolean).join('\n')
  }
}

/* ───────── KH: Chef DMs per step ───────── */
function chefNewRequestDM(doc) {
  const icon = iconFor(doc.status || 'NEW')
  return [
    `${icon} <b>ការកម្មង់អាហារថ្មី</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព៖ ${icon} <b>${esc(doc.status || 'NEW')}</b>`,
    ...linesForRecurringKh(doc.recurring || {}),
  ].filter(Boolean).join('\n')
}

function chefAcceptedDM(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>បានព្រមទទួលសំណើអាហារ</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព៖ ${icon} <b>ACCEPTED</b>`,
  ].filter(Boolean).join('\n')
}

function chefCookingDM(doc) {
  const icon = iconFor('COOKING')
  return [
    `${icon} <b>កំពុងចម្អិនអាហារ</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព៖ ${icon} <b>COOKING</b>`,
  ].filter(Boolean).join('\n')
}

function chefReadyDM(doc) {
  const icon = iconFor('READY')
  return [
    `${icon} <b>អាហារត្រៀមរួចរាល់</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព៖ ${icon} <b>READY</b>`,
  ].filter(Boolean).join('\n')
}

function chefDeliveredDM(doc) {
  const icon = iconFor('DELIVERED')
  return [
    `${icon} <b>បានដឹកជញ្ជូនអាហាររួចរាល់</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាពចុងក្រោយ៖ ${icon} <b>DELIVERED</b>`,
  ].filter(Boolean).join('\n')
}

function chefCancelDM(doc) {
  const icon = iconFor('CANCELED')
  return [
    `${icon} <b>សំណើអាហារត្រូវបានបោះបង់</b>`,
    '=============================',
    ...baseInfoKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាពចុងក្រោយ៖ ${icon} <b>CANCELED</b>`,
  ].filter(Boolean).join('\n')
}

/* ───────── Employee DMs (EN) ───────── */
function employeeBaseLines(doc) {
  const d = doc || {}
  const loc = d.location || {}

  return [
    `📌 Request: <b>${esc(d.requestId || d._id || '')}</b>`,
    `📅 Eat date: ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ Time: ${d.eatTimeStart ? esc(d.eatTimeStart) : '–'}${d.eatTimeEnd ? ` – ${esc(d.eatTimeEnd)}` : ''}`,
    `🥗 Meals: ${esc(joinOrDash(d.meals))}`,
    `👥 Quantity: <b>${toInt(d.quantity)}</b>`,
    `🏠 Location: ${esc(loc.kind || '')}${loc.kind === 'Other' && loc.other ? ` (${esc(loc.other)})` : ''}`,
  ]
}

function employeeNewRequestDM(doc) {
  const icon = iconFor(doc.status || 'NEW')
  return [
    `${icon} <b>Your food request was created</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>${esc(doc.status || 'NEW')}</b>`,
  ].filter(Boolean).join('\n')
}

function employeeAcceptedDM(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>Your food request was accepted</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>ACCEPTED</b>`,
  ].filter(Boolean).join('\n')
}

function employeeCookingDM(doc) {
  const icon = iconFor('COOKING')
  return [
    `${icon} <b>Your food is now being cooked</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>COOKING</b>`,
  ].filter(Boolean).join('\n')
}

function employeeReadyDM(doc) {
  const icon = iconFor('READY')
  return [
    `${icon} <b>Your food is ready</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>READY</b>`,
  ].filter(Boolean).join('\n')
}

function employeeDeliveredDM(doc) {
  const icon = iconFor('DELIVERED')
  return [
    `${icon} <b>Your food has been delivered</b>`,
    ...employeeBaseLines(doc),
    `📊 Final status: ${icon} <b>DELIVERED</b>`,
  ].filter(Boolean).join('\n')
}

function employeeCancelDM(doc) {
  const icon = iconFor('CANCELED')
  const reasonLine = doc.cancelReason
    ? `📝 Reason: ${esc(doc.cancelReason)}`
    : null

  return [
    `${icon} <b>Your food request was canceled</b>`,
    ...employeeBaseLines(doc),
    reasonLine,
    `📊 Final status: ${icon} <b>CANCELED</b>`,
  ].filter(Boolean).join('\n')
}

module.exports = {
  // EN (group)
  newRequestMsg,
  acceptedMsg,
  cookingMsg,
  readyMsg,
  deliveredMsg,
  cancelMsg,
  statusUpdateMsg,

  // KH (chef DM)
  chefNewRequestDM,
  chefAcceptedDM,
  chefCookingDM,
  chefReadyDM,
  chefDeliveredDM,
  chefCancelDM,

  // Employee DM (EN)
  employeeNewRequestDM,
  employeeAcceptedDM,
  employeeCookingDM,
  employeeReadyDM,
  employeeDeliveredDM,
  employeeCancelDM,
}
