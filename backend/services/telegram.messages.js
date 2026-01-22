// backend/services/telegram.messages.js
const dayjs = require('dayjs')

/* ───────── helpers ───────── */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const fmtDate = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const joinOrDash = (arr) => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—')
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const toInt = (v) => (v == null ? 0 : Number(v) || 0)

function safeNote(s, max = 600) {
  if (!s) return null
  const t = String(s)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function fmtTimeRange(start, end) {
  const s = String(start || '').trim()
  const e = String(end || '').trim()
  if (!s && !e) return '—'
  if (s && e) return `${esc(s)} - ${esc(e)}`
  return esc(s || e)
}

function fmtLocation(loc = {}) {
  const kind = String(loc?.kind || '').trim()
  const other = String(loc?.other || '').trim()
  if (!kind) return '—'
  if (kind === 'Other' && other) return `Other (${esc(other)})`
  // if your DB stores "Other" but UI shows "Other (xxx)" this matches screenshot style
  if (other && kind !== 'Other') return `${esc(kind)} (${esc(other)})`
  return esc(kind)
}

/* ───────── Keep ONLY your real statuses ───────── */
const STATUS_ICON = {
  NEW: '🟢',
  ACCEPTED: '🟡',
  CANCELED: '🔴',
}
function iconFor(status) {
  const key = String(status || 'NEW').toUpperCase()
  return STATUS_ICON[key] || '🔘'
}

/* ───────── Khmer maps (for CHEF DMs) ───────── */
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

const mapOne = (val, dict) => (val && dict[val]) || val || ''
const mapArray = (arr, dict) =>
  Array.isArray(arr) && arr.length ? arr.map((v) => mapOne(v, dict)).join(', ') : '—'

function fmtLocationKh(loc = {}) {
  const kind = String(loc?.kind || '').trim()
  const other = String(loc?.other || '').trim()
  if (!kind) return '—'
  const kindKh = mapOne(kind, LOCATION_KH) || kind
  if (kind === 'Other' && other) return `${esc(kindKh)} (${esc(other)})`
  if (other && kind !== 'Other') return `${esc(kindKh)} (${esc(other)})`
  return esc(kindKh)
}

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

/* ───────── EN: sections (match your screenshot vibe) ───────── */
function linesForMenuCounts(doc) {
  const m = menuMap(doc)
  const lines = ['🍱 Menu Counts:']
  if (!m.size) {
    lines.push('• —')
    return lines
  }

  const ordered = Array.from(m.entries()).sort((a, b) => {
    if (a[0] === 'Standard') return -1
    if (b[0] === 'Standard') return 1
    return a[0].localeCompare(b[0])
  })

  let total = 0
  for (const [choice, cnt] of ordered) {
    total += toInt(cnt)
    // screenshot style: "• Standard × 3"
    lines.push(`• ${esc(choice)} × <b>${toInt(cnt)}</b>`)
  }
  lines.push(`• <i>Total menus</i>: <b>${total}</b>`)
  return lines
}

function linesForDietary(doc) {
  const g = dietaryByMenu(doc)
  const dietaryRaw = joinOrDash(doc?.dietary)

  // screenshot style: show 2 lines even if empty
  const lines = [
    `⚠️ Dietary: ${esc(dietaryRaw)}`,
  ]

  if (!g.size) {
    lines.push('⚠️ Dietary Counts: —')
    if (doc?.dietaryOther) lines.push(`• Other: ${esc(doc.dietaryOther)}`)
    return lines
  }

  lines.push('⚠️ Dietary Counts:')
  // keep compact: flatten counts
  for (const [menu, inner] of Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const parts = Array.from(inner.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([allergen, cnt]) => `${esc(allergen)} × <b>${toInt(cnt)}</b>`)
    lines.push(`• ${esc(menu)}: ${parts.join(', ')}`)
  }
  if (doc?.dietaryOther) lines.push(`• Other: ${esc(doc.dietaryOther)}`)
  return lines
}

function baseInfoGroup(doc) {
  const d = doc || {}
  const emp = d.employee || {}
  const loc = d.location || {}

  const reqId = d.requestId || d._id || ''
  const titleId = esc(reqId)

  const lines = [
    `🎟 Request ID: <b>${titleId}</b>`,
    `🧍 Employee: <b>${esc(emp.name || '—')}</b>${emp.employeeId ? ` (${esc(emp.employeeId)})` : ''}`,
    `🏢 Department: ${esc(emp.department || '—')}`,
    `📅 Order Date: ${fmtDate(d.orderDate)}`,
    `📅 Eat Date: ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ Time: ${fmtTimeRange(d.eatTimeStart, d.eatTimeEnd)}`,
    `📋 Order Type: ${esc(d.orderType || '—')}`,
    `🥗 Meals: ${esc(joinOrDash(d.meals))}`,
    `👥 Quantity: <b>${toInt(d.quantity)}</b>`,
    `🏠 Location: ${fmtLocation(loc)}`,
    `📦 Menu Choices: ${esc(joinOrDash(d.menuChoices))}`,
    '-----------------------------',
    ...linesForMenuCounts(d),
    '-----------------------------',
    ...linesForDietary(d),
  ]

  const notes = []
  if (d.specialInstructions) notes.push(`📝 Note: ${esc(safeNote(d.specialInstructions))}`)
  if (d.cancelReason) notes.push(`🚫 Cancel Reason: ${esc(d.cancelReason)}`)
  if (notes.length) lines.push('-----------------------------', ...notes)

  return lines
}

/* ───────── KH: sections for CHEF DM (Khmer) ───────── */
function linesForMenuCountsKh(doc) {
  const m = menuMap(doc)
  const lines = ['🍱 ចំនួនម៉ឺនុយ៖']
  if (!m.size) {
    lines.push('• —')
    return lines
  }

  const ordered = Array.from(m.entries()).sort((a, b) => {
    if (a[0] === 'Standard') return -1
    if (b[0] === 'Standard') return 1
    return a[0].localeCompare(b[0])
  })

  let total = 0
  for (const [choice, cnt] of ordered) {
    total += toInt(cnt)
    const label = mapOne(choice, MENU_KH) || choice
    lines.push(`• ${esc(label)} × <b>${toInt(cnt)}</b>`)
  }
  lines.push(`• <i>សរុបម៉ឺនុយ</i>: <b>${total}</b>`)
  return lines
}

function linesForDietaryKh(doc) {
  const g = dietaryByMenu(doc)
  const dietaryLabel = Array.isArray(doc?.dietary) ? mapArray(doc.dietary, ALLERGEN_KH) : '—'
  const lines = [
    `⚠️ អាឡែស៊ី: ${esc(dietaryLabel || '—')}`,
  ]

  if (!g.size) {
    lines.push('⚠️ ចំនួនអាហារផ្សេងៗ: —')
    if (doc?.dietaryOther) lines.push(`• ផ្សេងៗ: ${esc(doc.dietaryOther)}`)
    return lines
  }

  lines.push('⚠️ ចំនួនអាហារផ្សេងៗ:')
  for (const [menu, inner] of Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const menuLabel = mapOne(menu, MENU_KH) || menu
    const parts = Array.from(inner.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([allergen, cnt]) => `${esc(mapOne(allergen, ALLERGEN_KH) || allergen)} × <b>${toInt(cnt)}</b>`)
    lines.push(`• ${esc(menuLabel)}: ${parts.join(', ')}`)
  }
  if (doc?.dietaryOther) lines.push(`• ផ្សេងៗ: ${esc(doc.dietaryOther)}`)
  return lines
}

function baseInfoChefKh(doc) {
  const d = doc || {}
  const emp = d.employee || {}
  const loc = d.location || {}

  const orderTypeKh = mapOne(d.orderType, ORDER_TYPE_KH) || d.orderType || '—'
  const mealsKh = Array.isArray(d.meals) ? mapArray(d.meals, MEAL_KH) : '—'

  const reqId = d.requestId || d._id || ''
  const lines = [
    `🎟 លេខសំណើ: <b>${esc(reqId)}</b>`,
    `🧍 និយោជិក: <b>${esc(emp.name || '—')}</b>${emp.employeeId ? ` (${esc(emp.employeeId)})` : ''}`,
    `🏢 ផ្នែក: ${esc(emp.department || '—')}`,
    `📅 កាលបរិច្ឆេទកម្មង់: ${fmtDate(d.orderDate)}`,
    `📅 កាលបរិច្ឆេទបរិភោគ: ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ ម៉ោង: ${fmtTimeRange(d.eatTimeStart, d.eatTimeEnd)}`,
    `📋 ប្រភេទកម្មង់: ${esc(orderTypeKh)}`,
    `🥗 មុខអាហារ: ${esc(mealsKh)}`,
    `👥 ចំនួន: <b>${toInt(d.quantity)}</b>`,
    `🏠 ទីតាំង: ${fmtLocationKh(loc)}`,
    `📦 ជម្រើសម៉ឺនុយ: ${esc(mapArray(d.menuChoices || [], MENU_KH) || '—')}`,
    '-----------------------------',
    ...linesForMenuCountsKh(d),
    '-----------------------------',
    ...linesForDietaryKh(d),
  ]

  const notes = []
  if (d.specialInstructions) notes.push(`📝 កំណត់ចំណាំ: ${esc(safeNote(d.specialInstructions))}`)
  if (d.cancelReason) notes.push(`🚫 មូលហេតុបោះបង់: ${esc(d.cancelReason)}`)
  if (notes.length) lines.push('-----------------------------', ...notes)

  return lines
}

/* ───────── EN: group messages (ONLY 3 statuses) ───────── */
function newRequestMsg(doc) {
  const icon = iconFor('NEW')
  return [
    `${icon} <b>New Food Request</b>`,
    '=============================',
    ...baseInfoGroup(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>NEW</b>`,
  ].join('\n')
}

function acceptedMsg(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>Request Accepted</b>`,
    '=============================',
    ...baseInfoGroup(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>ACCEPTED</b>`,
  ].join('\n')
}

function cancelMsg(doc) {
  const icon = iconFor('CANCELED')
  return [
    `${icon} <b>Request Canceled</b>`,
    '=============================',
    ...baseInfoGroup(doc),
    '-----------------------------',
    `📊 Status: ${icon} <b>CANCELED</b>`,
  ].join('\n')
}

/**
 * Generic dispatcher (keeps your code simple).
 * ✅ Only returns messages for NEW / ACCEPTED / CANCELED
 */
function statusUpdateMsg(doc) {
  const s = String(doc?.status || 'NEW').toUpperCase()
  if (s === 'ACCEPTED') return acceptedMsg(doc)
  if (s === 'CANCELED') return cancelMsg(doc)
  return newRequestMsg(doc)
}

/* ───────── KH: CHEF DMs (Khmer ONLY) ───────── */
function chefNewRequestDM(doc) {
  const icon = iconFor('NEW')
  return [
    `${icon} <b>ការកម្មង់អាហារថ្មី</b>`,
    '=============================',
    ...baseInfoChefKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព: ${icon} <b>NEW</b>`,
  ].join('\n')
}

function chefAcceptedDM(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>បានព្រមទទួលសំណើអាហារ</b>`,
    '=============================',
    ...baseInfoChefKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាព: ${icon} <b>ACCEPTED</b>`,
  ].join('\n')
}

function chefCancelDM(doc) {
  const icon = iconFor('CANCELED')
  return [
    `${icon} <b>សំណើអាហារត្រូវបានបោះបង់</b>`,
    '=============================',
    ...baseInfoChefKh(doc),
    '-----------------------------',
    `📊 ស្ថានភាពចុងក្រោយ: ${icon} <b>CANCELED</b>`,
  ].join('\n')
}

/* ───────── Employee DMs (EN, simple) ───────── */
function employeeBaseLines(doc) {
  const d = doc || {}
  const loc = d.location || {}
  return [
    `🎟 Request ID: <b>${esc(d.requestId || d._id || '')}</b>`,
    `📅 Eat Date: ${fmtDate(d.eatDate || d.serveDate)}`,
    `⏰ Time: ${fmtTimeRange(d.eatTimeStart, d.eatTimeEnd)}`,
    `🥗 Meals: ${esc(joinOrDash(d.meals))}`,
    `👥 Quantity: <b>${toInt(d.quantity)}</b>`,
    `🏠 Location: ${fmtLocation(loc)}`,
  ]
}

function employeeNewRequestDM(doc) {
  const icon = iconFor('NEW')
  return [
    `${icon} <b>Your food request was created</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>NEW</b>`,
  ].join('\n')
}

function employeeAcceptedDM(doc) {
  const icon = iconFor('ACCEPTED')
  return [
    `${icon} <b>Your food request was accepted</b>`,
    ...employeeBaseLines(doc),
    `📊 Status: ${icon} <b>ACCEPTED</b>`,
  ].join('\n')
}

function employeeCancelDM(doc) {
  const icon = iconFor('CANCELED')
  const reasonLine = doc?.cancelReason ? `📝 Reason: ${esc(doc.cancelReason)}` : null
  return [
    `${icon} <b>Your food request was canceled</b>`,
    ...employeeBaseLines(doc),
    reasonLine,
    `📊 Final status: ${icon} <b>CANCELED</b>`,
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  // EN (group)
  newRequestMsg,
  acceptedMsg,
  cancelMsg,
  statusUpdateMsg,

  // KH (chef DM) ✅ Khmer only
  chefNewRequestDM,
  chefAcceptedDM,
  chefCancelDM,

  // Employee DM (EN)
  employeeNewRequestDM,
  employeeAcceptedDM,
  employeeCancelDM,
}
