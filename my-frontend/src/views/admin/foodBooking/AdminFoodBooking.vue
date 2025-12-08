<!-- src/views/admin/foodBooking/AdminFoodBooking.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import * as XLSX from 'xlsx'
import { useToast } from '@/composables/useToast'

const auth  = useAuth()
const route = useRoute()
const { showToast } = useToast()

/* ───────── responsive flag (no Vuetify) ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  isMobile.value = window.innerWidth < 768
}

/* ───────── state ───────── */
const loading  = ref(false)
const rows     = ref([])
const q        = ref('')
const status   = ref('ALL')
const fromDate = ref('')
const toDate   = ref('')

const page    = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const statuses = ['ACTIVE','ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']

/* Status chip + button colors (Tailwind classes) */
const STATUS_CHIP_CLASS = {
  NEW:       'bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-slate-900',
  ACCEPTED:  'bg-indigo-500 text-white',
  COOKING:   'bg-orange-500 text-white',
  READY:     'bg-teal-500 text-white',
  DELIVERED: 'bg-emerald-500 text-white',
  CANCELED:  'bg-red-500 text-white',
}
const statusChipClass = s => STATUS_CHIP_CLASS[s] || 'bg-slate-300 text-slate-800'

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({
  ...o,
  _id: String(o?._id || ''),
  requestId: String(o?.requestId || ''),
  orderType: o?.orderType || '',
  quantity: Number(o?.quantity || 0),
  meals: Array.isArray(o?.meals) ? o.meals : [],
  menuChoices: Array.isArray(o?.menuChoices) ? o.menuChoices : [],
  menuCounts: Array.isArray(o?.menuCounts) ? o.menuCounts : [],
  dietary: Array.isArray(o?.dietary) ? o.dietary : [],
  dietaryCounts: Array.isArray(o?.dietaryCounts) ? o.dietaryCounts : [],
})

/* ───────── MENU / DIETARY math ───────── */
function menuMap(r) {
  const m = new Map()
  for (const it of (r.menuCounts || [])) {
    if (!it?.choice) continue
    const n = Number(it.count || 0)
    if (!n) continue
    m.set(it.choice, (m.get(it.choice) || 0) + n)
  }
  if (!m.has('Standard')) {
    const nonStd = Array.from(m.entries())
      .filter(([k]) => k !== 'Standard')
      .reduce((s, [, v]) => s + v, 0)
    const std = Math.max(Number(r.quantity || 0) - nonStd, 0)
    if (std > 0) m.set('Standard', std)
  }
  for (const [k, v] of m.entries()) if (!v) m.delete(k)
  return m
}
function dietaryByMenu(r) {
  const g = new Map()
  for (const d of (r.dietaryCounts || [])) {
    const menu = d?.menu || 'Standard'
    const allergen = d?.allergen
    const cnt = Number(d?.count || 0)
    if (!allergen || !cnt) continue
    if (!g.has(menu)) g.set(menu, new Map())
    const inner = g.get(menu)
    inner.set(allergen, (inner.get(allergen) || 0) + cnt)
  }
  return g
}

/* ───────── expand/collapse ───────── */
const expanded = ref(new Set())
const isExpanded = id => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* ───────── CRUD / data load ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (status.value === 'ACTIVE' && ['DELIVERED','CANCELED'].includes(d.status)) {
    if (i !== -1) rows.value.splice(i, 1)
    expanded.value.delete(d._id)
    return
  }
  if (i === -1) rows.value.unshift(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(id)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value.trim()) params.set('q', q.value.trim())
    if (status.value && status.value !== 'ALL' && status.value !== 'ACTIVE') params.set('status', status.value)
    if (fromDate.value) params.set('from', fromDate.value)
    if (toDate.value) params.set('to', toDate.value)

    const { data } = await api.get(`/admin/food-requests?${params.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    if (status.value === 'ACTIVE') list = list.filter(r => !['DELIVERED','CANCELED'].includes(r.status))
    rows.value = list.map(normalize)
    page.value = 1
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || e.message || 'Could not load requests.',
    })
  } finally { loading.value = false }
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)

  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  // date from calendar → focus a single day, else today
  const qDate = route.query.date
  if (qDate) {
    const dStr = dayjs(qDate).isValid()
      ? dayjs(qDate).format('YYYY-MM-DD')
      : String(qDate)
    fromDate.value = dStr
    toDate.value   = dStr
  } else {
    const today = dayjs().format('YYYY-MM-DD')
    fromDate.value = today
    toDate.value   = today
  }

  const focus = route.query.focus
  if (focus) {
    const s = new Set(expanded.value)
    s.add(String(focus))
    expanded.value = s
  }

  await load()

  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id || '')))
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
  window.removeEventListener('resize', updateIsMobile)
})

watch([q, status, fromDate, toDate], () => { page.value = 1; load() })

watch(
  () => route.query.date,
  (val) => {
    if (!val) return
    const dStr = dayjs(val).isValid()
      ? dayjs(val).format('YYYY-MM-DD')
      : String(val)
    fromDate.value = dStr
    toDate.value   = dStr
  }
)
watch(
  () => route.query.focus,
  (val) => {
    if (!val) return
    const s = new Set(expanded.value)
    s.add(String(val))
    expanded.value = s
  }
)

/* ───────── paging ───────── */
const totalItems = computed(() => rows.value.length)
const totalPages = computed(() =>
  perPage.value === 'All'
    ? 1
    : Math.max(1, Math.ceil(totalItems.value / perPage.value))
)
const pages = computed(() =>
  Array.from({ length: totalPages.value }, (_, i) => i + 1)
)
const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

/* ───────── workflow ───────── */
const nextSteps = (s) => {
  switch (s) {
    case 'NEW':       return ['ACCEPTED','CANCELED']
    case 'ACCEPTED':  return ['COOKING','CANCELED']
    case 'COOKING':   return ['READY','CANCELED']
    case 'READY':     return ['DELIVERED','CANCELED']
    default:          return []
  }
}

/* Cancel reason modal */
const cancelModalOpen = ref(false)
const cancelModalRow   = ref(null)
const cancelReason     = ref('')
const cancelReasonOptions = [
  { value: 'not_have',       label: 'Not have' },
  { value: 'not_enough',     label: 'Not enough' },
  { value: 'direct_message', label: 'Please directly message instead' },
  { value: 'out_of_stock',   label: 'Out of stock' },
  { value: 'off_hours',      label: 'Not work hour' },
  { value: 'other',          label: 'Other' },
]

function handleStatusClick(row, target) {
  if (!row?._id) {
    showToast({
      type: 'error',
      title: 'Missing ID',
      message: 'This row has no Mongo _id. Cannot update status.',
    })
    return
  }
  if (target === 'CANCELED') {
    cancelModalRow.value = row
    cancelReason.value = ''
    cancelModalOpen.value = true
  } else {
    doUpdateStatus(row, target)
  }
}

async function confirmCancelStatus() {
  if (!cancelModalRow.value || !cancelReason.value) {
    showToast({
      type: 'warning',
      title: 'Reason required',
      message: 'Please select a cancel reason.',
    })
    return
  }
  const row = cancelModalRow.value
  cancelModalOpen.value = false
  await doUpdateStatus(row, 'CANCELED', cancelReason.value)
}

async function doUpdateStatus(row, target, reason = '') {
  const before = { ...row }
  try {
    const url = `/admin/food-requests/${encodeURIComponent(row._id)}/status`
    const payload = { status: target }
    if (target === 'CANCELED') payload.reason = reason

    const { data: updated } = await api.patch(url, payload)
    upsertRow(updated)
    showToast({
      type: 'success',
      title: 'Status updated',
      message: `Request ${row.requestId || row._id.slice(-6)} → ${target}`,
    })
  } catch (e) {
    upsertRow(before)
    showToast({
      type: 'error',
      title: 'Update failed',
      message: e?.response?.data?.message || e.message || 'Request failed.',
    })
  }
}

/* ───────── filters ───────── */
function resetFilters() {
  q.value = ''
  status.value = 'ALL'
  const today = dayjs().format('YYYY-MM-DD')
  fromDate.value = today
  toDate.value   = today
  page.value = 1
  load()
}

/* ───────── Export to Excel (3 sheets) ───────── */
const exporting = ref(false)

function toMainRow(r) {
  return {
    _id: r._id,
    RequestID: r.requestId || '',
    Status: r.status || '',
    OrderType: r.orderType || '',
    Quantity: r.quantity || 0,
    EmployeeID: r.employee?.employeeId || '',
    Name: r.employee?.name || '',
    Department: r.employee?.department || '',
    OrderDate: fmtDate(r.orderDate),
    EatDate: fmtDate(r.eatDate),
    Time: [r.eatTimeStart, r.eatTimeEnd].filter(Boolean).join(' – '),
    MenuChoices: Array.isArray(r.menuChoices) ? r.menuChoices.join(', ') : '',
    DietarySelected: Array.isArray(r.dietary) ? r.dietary.join(', ') : '',
    DietaryOther: r.dietaryOther || '',
    SpecialInstructions: r.specialInstructions || '',
    Recurring: r?.recurring?.enabled
      ? `${r.recurring.frequency}${r.recurring.endDate ? ' until ' + fmtDate(r.recurring.endDate) : ''}${r.recurring.skipHolidays ? ' (skip holidays)' : ''}`
      : '',
  }
}
function buildMenuRows(list) {
  const out = []
  for (const r of list) {
    const m = menuMap(r)
    for (const [menuName, count] of m.entries()) {
      out.push({
        RequestID: r.requestId || '',
        Status: r.status || '',
        EatDate: fmtDate(r.eatDate),
        Menu: menuName,
        Count: count,
      })
    }
  }
  return out
}
function buildDietaryRows(list) {
  const out = []
  for (const r of list) {
    const g = dietaryByMenu(r)
    for (const [menuName, inner] of g.entries()) {
      for (const [allergen, count] of inner.entries()) {
        out.push({
          RequestID: r.requestId || '',
          Status: r.status || '',
          EatDate: fmtDate(r.eatDate),
          Menu: menuName,
          Allergen: allergen,
          Count: count,
        })
      }
    }
  }
  return out
}

async function exportExcel() {
  try {
    exporting.value = true
    const list = rows.value
    const wb = XLSX.utils.book_new()

    const main = list.map(toMainRow)
    const wsMain = XLSX.utils.json_to_sheet(main)
    XLSX.utils.book_append_sheet(wb, wsMain, 'Requests')

    const menuRows = buildMenuRows(list)
    const wsMenus = XLSX.utils.json_to_sheet(menuRows)
    XLSX.utils.book_append_sheet(wb, wsMenus, 'Menus')

    const dietRows = buildDietaryRows(list)
    const wsDiet = XLSX.utils.json_to_sheet(dietRows)
    XLSX.utils.book_append_sheet(wb, wsDiet, 'Dietary')

    for (const ws of [wsMain, wsMenus, wsDiet]) {
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const colWidths =
        data[0]?.map((_, c) => ({
          wch: Math.min(
            50,
            Math.max(...data.map(row => String(row?.[c] ?? '').length), 8),
          ),
        })) || []
      ws['!cols'] = colWidths
    }

    const rangeText = [
      fromDate.value ? `from_${fromDate.value}` : '',
      toDate.value ? `to_${toDate.value}` : '',
      status.value && status.value !== 'ALL' ? `status_${status.value}` : '',
    ]
      .filter(Boolean)
      .join('_')
    const stamp = dayjs().format('YYYYMMDD_HHmmss')
    const fname = `FoodRequests_${rangeText || 'all'}_${stamp}.xlsx`

    XLSX.writeFile(wb, fname)

    showToast({
      type: 'success',
      title: 'Export completed',
      message: `Saved as ${fname}`,
    })
  } catch (err) {
    console.error(err)
    showToast({
      type: 'error',
      title: 'Export failed',
      message: err?.message || 'Unknown error while exporting.',
    })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Header bar -->
      <div
        class="rounded-t-2xl border-b border-slate-200 bg-gradient-to-r
               from-[#0f719e] via-[#b3b4df] to-[#ae9aea]
               px-3 py-2 text-slate-900
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 dark:text-slate-100"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-col leading-tight">
            <span
              class="text-[10px] font-semibold uppercase tracking-[0.24em]
                     text-slate-800/80 dark:text-slate-200/80"
            >
              Food Request
            </span>
            <span class="text-sm font-semibold">
              Admin requests overview
            </span>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-slate-800/80 dark:text-slate-100/80">
            <span>Total: {{ totalItems }}</span>
          </div>
        </div>
      </div>

      <!-- Filters row -->
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50
               px-2 py-2 sm:px-3
               dark:border-slate-700 dark:bg-slate-900/80"
      >
        <input
          v-model="q"
          type="text"
          placeholder="Search"
          class="h-8 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900 placeholder-slate-400
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
          @keyup.enter="load"
        />

        <select
          v-model="status"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option
            v-for="s in statuses"
            :key="s"
            :value="s"
          >
            {{ s }}
          </option>
        </select>

        <input
          v-model="fromDate"
          type="date"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <input
          v-model="toDate"
          type="date"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />

        <select
          v-model="perPage"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option
            v-for="opt in perPageOptions"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>

        <button
          type="button"
          class="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          :disabled="loading"
          @click="load"
        >
          <span
            v-if="loading"
            class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-slate-500 border-t-transparent"
          />
          Refresh
        </button>

        <button
          type="button"
          class="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-400 bg-emerald-500 px-2 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-60
                 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          :disabled="exporting"
          @click="exportExcel"
        >
          <span
            v-if="exporting"
            class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-white/70 border-t-transparent"
          />
          Export
        </button>

        <button
          type="button"
          class="ml-auto inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          @click="resetFilters"
        >
          Reset
        </button>
      </div>

      <!-- Content -->
      <div class="px-2 py-2 sm:px-3 sm:py-3">
        <!-- MOBILE: CARD LIST -->
        <div v-if="isMobile" class="space-y-3">
          <div
            v-if="loading"
            class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Loading requests…
          </div>

          <div
            v-else-if="!pagedRows.length"
            class="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            No requests found.
          </div>

          <div
            v-else
            v-for="r in pagedRows"
            :key="r._id"
            class="rounded-2xl border border-slate-300 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3 shadow-md
                   dark:border-slate-700 dark:from-slate-800 dark:via-slate-900 dark:to-slate-900"
            :class="{ 'bg-amber-50 dark:bg-amber-900/40': route.query.focus === r._id }"
          >
            <!-- top: status + dates/time -->
            <div class="flex items-start justify-between gap-2">
              <div>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="statusChipClass(r.status)"
                >
                  {{ r.status }}
                </span>
                <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtDate(r.orderDate) }} → {{ fmtDate(r.eatDate) }}
                </div>
              </div>
              <div class="text-right">
                <div class="text-xs font-semibold">
                  {{ r.eatTimeStart || '—' }}
                  <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ r.employee?.department || '—' }}
                </div>
              </div>
            </div>

            <div class="my-2 h-px bg-slate-200 dark:bg-slate-700" />

            <!-- requester -->
            <div class="mt-1 flex gap-2 text-xs">
              <div class="w-28 shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Requester
              </div>
              <div class="flex-1">
                {{ r.employee?.name || '—' }}
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  ID {{ r.employee?.employeeId || '—' }}
                </div>
              </div>
            </div>

            <!-- order type -->
            <div class="mt-1 flex gap-2 text-xs">
              <div class="w-28 shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Order type
              </div>
              <div class="flex-1">
                {{ r.orderType || '—' }}
              </div>
            </div>

            <!-- meals / qty -->
            <div class="mt-1 flex gap-2 text-xs">
              <div class="w-28 shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Meals
              </div>
              <div class="flex-1">
                {{ (r.meals || []).join(', ') || '—' }}
                <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Qty: {{ r.quantity }}
                </div>
              </div>
            </div>

            <!-- location -->
            <div class="mt-1 flex gap-2 text-xs">
              <div class="w-28 shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Location
              </div>
              <div class="flex-1">
                {{ r?.location?.kind || '—' }}
                <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
              </div>
            </div>

            <!-- actions -->
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="s in nextSteps(r.status)"
                  :key="s"
                  type="button"
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold
                         border transition"
                  :class="s === 'CANCELED'
                    ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60'
                    : s === 'DELIVERED'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                      : 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/60'"
                  @click="handleStatusClick(r, s)"
                >
                  {{ s }}
                </button>
              </div>

              <button
                type="button"
                class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                @click="toggleExpanded(r._id)"
              >
                {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
              </button>
            </div>

            <!-- details tree -->
            <transition name="fade">
              <div v-if="isExpanded(r._id)" class="mt-2 text-xs">
                <div class="tree">
                  <div class="tree-node root">
                    <div class="node-label">
                      <strong>Quantity</strong> {{ r.quantity }}
                    </div>
                    <div class="children">
                      <template
                        v-for="[menuName, menuCnt] in menuMap(r)"
                        :key="menuName"
                      >
                        <div class="tree-node">
                          <div class="node-label">
                            <span class="arrow">→</span>
                            <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                          </div>
                          <div
                            v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length"
                            class="children"
                          >
                            <div
                              v-for="[allergen, aCnt] in Array.from(
                                (dietaryByMenu(r).get(menuName) || new Map()).entries()
                              )"
                              :key="menuName + '_' + allergen"
                              class="tree-node leaf"
                            >
                              <div class="node-label">
                                <span class="arrow small">↳</span>
                                {{ allergen }} ×{{ aCnt }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>

        <!-- DESKTOP TABLE -->
        <div v-else class="overflow-x-auto">
          <table class="min-w-full border-collapse text-[13px]">
            <thead>
              <tr class="bg-slate-100 dark:bg-slate-800">
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Status</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold w-72 dark:border-slate-700">Actions</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Requester (ID & Name)
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Order Date</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Eat Date</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Time</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Dept</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Order Type</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Meals</th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Qty</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-if="loading"
                class="bg-white dark:bg-slate-900"
              >
                <td
                  colspan="10"
                  class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500
                         dark:border-slate-700 dark:text-slate-300"
                >
                  Loading requests…
                </td>
              </tr>

              <template v-else>
                <template v-for="r in pagedRows" :key="r._id">
                  <tr
                    :class="[
                      'bg-white hover:bg-sky-50 transition-colors dark:bg-slate-900 dark:hover:bg-slate-800',
                      route.query.focus === r._id ? 'bg-amber-50 dark:bg-amber-900/40' : ''
                    ]"
                  >
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        :class="statusChipClass(r.status)"
                      >
                        {{ r.status }}
                      </span>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="mb-1 flex flex-wrap gap-1">
                        <button
                          v-for="s in nextSteps(r.status)"
                          :key="s"
                          type="button"
                          class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold
                                 border transition"
                          :class="s === 'CANCELED'
                            ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60'
                            : s === 'DELIVERED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                              : 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/60'"
                          @click="handleStatusClick(r, s)"
                        >
                          {{ s }}
                        </button>
                      </div>
                      <button
                        type="button"
                        class="mt-1 text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                        @click="toggleExpanded(r._id)"
                      >
                        {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                      </button>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ r.employee?.employeeId || '—' }} — {{ r.employee?.name || '—' }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ fmtDate(r.orderDate) }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ fmtDate(r.eatDate) }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ r.eatTimeStart || '—' }}
                      <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ r.employee?.department || '—' }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ r.orderType }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ (r.meals || []).join(', ') || '—' }}
                    </td>
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      {{ r.quantity }}
                    </td>
                  </tr>

                  <tr
                    v-if="isExpanded(r._id)"
                    class="bg-slate-50 dark:bg-slate-900/80"
                  >
                    <td
                      colspan="10"
                      class="border border-slate-300 px-3 py-2 dark:border-slate-700"
                    >
                      <div class="tree text-[12px]">
                        <div class="tree-node root">
                          <div class="node-label">
                            <strong>Quantity</strong> {{ r.quantity }}
                          </div>
                          <div class="children">
                            <template
                              v-for="[menuName, menuCnt] in menuMap(r)"
                              :key="menuName"
                            >
                              <div class="tree-node">
                                <div class="node-label">
                                  <span class="arrow">→</span>
                                  <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                                </div>
                                <div
                                  v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length"
                                  class="children"
                                >
                                  <div
                                    v-for="[allergen, aCnt] in Array.from(
                                      (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                    )"
                                    :key="menuName + '_' + allergen"
                                    class="tree-node leaf"
                                  >
                                    <div class="node-label">
                                      <span class="arrow small">↳</span>
                                      {{ allergen }} ×{{ aCnt }}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </template>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>

                <tr v-if="!pagedRows.length">
                  <td
                    colspan="10"
                    class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500
                           dark:border-slate-700 dark:text-slate-300"
                  >
                    No requests found.
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="perPage !== 'All'"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600
               dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300"
      >
        <div>
          Page {{ page }} / {{ totalPages }} •
          Showing
          <span v-if="totalItems === 0">0</span>
          <span v-else>
            {{ (page - 1) * (perPage === 'All' ? totalItems : perPage) + 1 }} -
            {{
              Math.min(
                page * (perPage === 'All' ? totalItems : perPage),
                totalItems,
              )
            }}
          </span>
          of {{ totalItems }}
        </div>
        <div class="inline-flex items-center gap-1">
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:opacity-40"
            :disabled="page <= 1"
            @click="page > 1 && (page = page - 1)"
          >
            Prev
          </button>
          <button
            v-for="p in pages"
            :key="p"
            type="button"
            class="rounded border px-2 py-1 text-[11px]"
            :class="p === page
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-900/40 dark:text-sky-200'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'"
            @click="page = p"
          >
            {{ p }}
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:opacity-40"
            :disabled="page >= totalPages"
            @click="page < totalPages && (page = page + 1)"
          >
            Next
          </button>
        </div>
      </div>
    </div>

    <!-- Cancel reason modal -->
    <transition name="fade">
      <div
        v-if="cancelModalOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4"
      >
        <div
          class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Cancel request
          </h2>
          <p class="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            Please select a reason for cancelling this meal request.
          </p>

          <div class="mt-3 space-y-2 text-xs">
            <label class="block text-[11px] font-medium text-slate-700 dark:text-slate-200">
              Reason
            </label>
            <select
              v-model="cancelReason"
              class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900
                     outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="" disabled>Select reason</option>
              <option
                v-for="opt in cancelReasonOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div class="mt-4 flex justify-end gap-2 text-[11px]">
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="cancelModalOpen = false"
            >
              Back
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-400 bg-red-500 px-3 py-1.5 font-semibold text-white hover:bg-red-400
                     dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-500"
              @click="confirmCancelStatus"
            >
              Confirm cancel
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tree {
  line-height: 1.4;
}
.tree .node-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.08);
}
.tree .root > .node-label {
  background: rgba(16, 185, 129, 0.16);
}
.tree .leaf .node-label {
  background: rgba(234, 179, 8, 0.16);
}
.children {
  margin-left: 1.1rem;
  padding-left: 0.6rem;
  border-left: 2px dashed rgba(148, 163, 184, 0.7);
  margin-top: 0.3rem;
}
.arrow {
  font-weight: 700;
}
.arrow.small {
  opacity: 0.9;
}

/* fade transition for details + modal */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
