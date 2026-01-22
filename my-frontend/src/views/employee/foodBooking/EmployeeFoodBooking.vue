<!-- src/views/employee/foodBooking/EmployeeFoodBooking.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/utils/api'
import dayjs from 'dayjs'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const { showToast } = useToast()

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── state ───────── */
const loading = ref(false)
const loadError = ref('')
const rows = ref([])

const q = ref('')
const status = ref('ALL')

/**
 * ✅ Employee view statuses
 * - NEW (pending)
 * - ACCEPTED (chef/admin accepted)
 * - CANCELED (employee or admin canceled)
 */
const statuses = ['ALL', 'NEW', 'ACCEPTED', 'CANCELED']

const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* single-day date filter */
const todayStr = dayjs().format('YYYY-MM-DD')
const filterDate = ref(todayStr)

/* pagination */
const page = ref(1)
const itemsPerPage = ref(10)
const itemsPerPageOptions = [10, 20, 50, 100, 'All']

/* expand/collapse per row */
const expanded = ref(new Set())
const isExpanded = (id) => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* focus & highlight from calendar */
const focusId = ref(route.query.focus ? String(route.query.focus) : '')
const focusDate = ref(route.query.date ? String(route.query.date) : '')

function applyFocusDateFilter() {
  if (focusDate.value) filterDate.value = focusDate.value
}

/* ───────── helpers ───────── */
const fmtDate = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const dateVal = (d) => (d ? dayjs(d).valueOf() : 0)
const sortKey = (r) => Math.max(dateVal(r.orderDate), dateVal(r.createdAt), dateVal(r.eatDate))

function normalize(o) {
  return {
    ...o,
    _id: String(o?._id || ''),
    requestId: String(o?.requestId || ''),
    status: (o?.status || 'NEW').toUpperCase(),
    orderType: o?.orderType || 'Daily meal',
    quantity: Number(o?.quantity || 0),
    eatDate: o?.eatDate || o?.serveDate || null,
    serveDate: o?.serveDate || null,
    eatTimeStart: o?.eatTimeStart || '',
    eatTimeEnd: o?.eatTimeEnd || '',
    meals: Array.isArray(o?.meals) ? o.meals : [],
    menuChoices: Array.isArray(o?.menuChoices) ? o.menuChoices : [],
    menuCounts: Array.isArray(o?.menuCounts) ? o.menuCounts : [],
    dietaryCounts: Array.isArray(o?.dietaryCounts) ? o.dietaryCounts : [],
    dietary: Array.isArray(o?.dietary) ? o.dietary : [],
    location: o?.location || {},
    employee: o?.employee || {},
    specialInstructions: o?.specialInstructions || '',
    cancelReason: o?.cancelReason || '',
    createdAt: o?.createdAt || null,
    updatedAt: o?.updatedAt || null,
  }
}

function passFilters(doc) {
  if (!doc) return false

  // employee scope
  if (employeeId.value && String(doc?.employee?.employeeId) !== String(employeeId.value)) return false

  // status filter
  if (status.value !== 'ALL' && doc.status !== status.value) return false

  // search
  if (q.value.trim()) {
    const rx = new RegExp(q.value.trim(), 'i')
    const hay = [
      doc.requestId,
      doc.orderType,
      (doc.meals || []).join(', '),
      (doc.menuChoices || []).join(', '),
      doc?.location?.kind,
      doc?.location?.other,
      doc?.employee?.name,
      doc.specialInstructions,
      (doc.dietary || []).join(', '),
    ]
      .filter(Boolean)
      .join(' ')
    if (!rx.test(hay)) return false
  }

  return true
}

function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex((r) => r._id === d._id)

  if (passFilters(d)) {
    if (i === -1) rows.value.unshift(d)
    else rows.value[i] = d
    rows.value = rows.value.slice().sort((a, b) => sortKey(b) - sortKey(a))
  } else if (i !== -1) {
    rows.value.splice(i, 1)
    expanded.value.delete(String(d._id))
  }
}

function removeRowById(id) {
  const i = rows.value.findIndex((r) => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(String(id))
}

/* ───────── API ───────── */
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams()
    if (employeeId.value) params.set('employeeId', employeeId.value)

    if (status.value !== 'ALL') params.set('status', status.value)
    if (q.value.trim()) params.set('q', q.value.trim())

    if (filterDate.value) {
      params.set('from', filterDate.value)
      params.set('to', filterDate.value)
    }

    const { data } = await api.get(`/public/food-requests?${params.toString()}`)
    const list = Array.isArray(data) ? data : data?.rows || data?.data || []

    rows.value = (list || []).map(normalize).sort((a, b) => sortKey(b) - sortKey(a))
    page.value = 1
  } catch (e) {
    console.error('Failed to load food requests', e)
    loadError.value = e?.response?.data?.message || e?.message || 'Failed to load data.'
    showToast({
      type: 'error',
      title: 'Unable to load requests',
      message: loadError.value,
      timeout: 2600,
    })
  } finally {
    loading.value = false
  }
}

/* ───────── computed ───────── */
const filteredRows = computed(() => rows.value.slice().sort((a, b) => sortKey(b) - sortKey(a)))

const pagedRows = computed(() => {
  if (itemsPerPage.value === 'All') return filteredRows.value
  const per = Number(itemsPerPage.value || 10)
  const start = (page.value - 1) * per
  return filteredRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (itemsPerPage.value === 'All') return 1
  const per = Number(itemsPerPage.value || 10)
  return Math.ceil(filteredRows.value.length / per) || 1
})

/* ───────── status UI ───────── */
const STATUS_STYLES = {
  NEW: 'bg-slate-100 text-slate-900 border-slate-500',
  ACCEPTED: 'bg-sky-100 text-sky-900 border-sky-600',
  CANCELED: 'bg-rose-100 text-rose-900 border-rose-600',
}
const statusBadgeClass = (s) => STATUS_STYLES[s] || 'bg-slate-100 text-slate-900 border-slate-500'

function statusLabel(s) {
  if (s === 'NEW') return 'Pending'
  if (s === 'ACCEPTED') return 'Accepted'
  if (s === 'CANCELED') return 'Canceled'
  return s || '—'
}

/* ───────── cancel rules ─────────
   ✅ employee can cancel ONLY if not yet accepted
*/
function canEmployeeCancel(r) {
  if (!r) return false
  return String(r.status || '') === 'NEW'
}

/* ───────── Confirm cancel modal (NO reason) ───────── */
const confirmModalOpen = ref(false)
const confirmTarget = ref(null)
const canceling = ref(false)

function openConfirmCancel(r) {
  confirmTarget.value = r
  confirmModalOpen.value = true
}
function closeConfirmCancel() {
  if (canceling.value) return
  confirmModalOpen.value = false
  confirmTarget.value = null
  canceling.value = false
}

async function cancelRequest(r) {
  if (!r?._id) return
  if (!canEmployeeCancel(r)) return

  canceling.value = true
  try {
    await api.patch(`/public/food-requests/${r._id}/cancel`, {
      employeeId: employeeId.value, // ✅ required by backend
    })

    // Optimistic update
    upsertRow({ ...r, status: 'CANCELED', cancelReason: '' })

    showToast({
      type: 'success',
      title: 'Canceled',
      message: `Your request (${r.requestId || r._id}) was canceled.`,
      timeout: 2400,
    })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Cancel failed.'
    showToast({
      type: 'error',
      title: 'Cancel failed',
      message: msg,
      timeout: 2800,
    })
  } finally {
    canceling.value = false
    closeConfirmCancel()
  }
}


async function confirmCancel() {
  if (!confirmTarget.value) return
  await cancelRequest(confirmTarget.value)
}

/* ───────── sockets ───────── */
function registerSocket() {
  socket.on('foodRequest:created', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (String(empId) !== String(employeeId.value)) return
    upsertRow(doc)
    showToast({
      type: 'success',
      title: 'Meal request submitted',
      message: 'System has received your meal request.',
      timeout: 2000,
    })
  })

  socket.on('foodRequest:updated', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (String(empId) !== String(employeeId.value)) return
    upsertRow(doc)
  })

  socket.on('foodRequest:statusChanged', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (String(empId) !== String(employeeId.value)) return
    upsertRow(doc)

    showToast({
      type: 'info',
      title: `Status: ${statusLabel(doc.status)}`,
      message:
        doc.status === 'ACCEPTED'
          ? 'Your request has been accepted and will be prepared.'
          : doc.status === 'CANCELED'
            ? 'This request is canceled and will not be prepared.'
            : 'Your meal request status has changed.',
      timeout: 2400,
    })
  })

  socket.on('foodRequest:deleted', ({ _id }) => {
    // in case admin really deletes
    removeRowById(String(_id || ''))
    showToast({
      type: 'warning',
      title: 'Removed',
      message: 'This request has been removed.',
      timeout: 2300,
    })
  })
}

function unregisterSocket() {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
}

/* ───────── focus highlight (from calendar) ───────── */
async function focusOnRowIfNeeded() {
  if (!focusId.value) return

  const idx = filteredRows.value.findIndex((r) => r._id === focusId.value)
  if (idx === -1) return

  if (itemsPerPage.value !== 'All') {
    const per = Number(itemsPerPage.value) || 20
    page.value = Math.floor(idx / per) + 1
  } else {
    page.value = 1
  }

  await nextTick()

  setTimeout(() => {
    const el = document.querySelector(`[data-row-id="${focusId.value}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-row')
      setTimeout(() => el.classList.remove('highlight-row'), 5000)
    }
  }, 300)
}

/* ───────── MENU / DIETARY mapping ───────── */
function menuMap(r) {
  const m = new Map()
  for (const it of r.menuCounts || []) {
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
  for (const d of r.dietaryCounts || []) {
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

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  subscribeEmployeeIfNeeded()
  applyFocusDateFilter()
  await load()
  registerSocket()
  await focusOnRowIfNeeded()
})

onBeforeUnmount(() => {
  unregisterSocket()
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})

watch([q, status, filterDate], () => {
  page.value = 1
  load()
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0">
    <div
      class="rounded-2xl border border-slate-400 bg-slate-100/90 shadow-sm
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <!-- Hero / filters bar -->
      <div
        class="bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 rounded-t-2xl
               px-4 py-3 text-white"
      >
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1 min-w-[220px] max-w-xs">
            <p class="text-[11px] uppercase tracking-[0.2em] text-sky-200">
              My meal requests
            </p>
            <p class="text-sm font-semibold">
              Today's &amp; upcoming orders
            </p>
          </div>

          <!-- Search -->
          <div class="flex-1 min-w-[220px] max-w-sm">
            <label class="mb-1 block text-[11px] font-medium text-sky-100">
              Search
            </label>
            <div class="flex items-center rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-xs">
              <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-200/80" />
              <input
                v-model="q"
                type="text"
                placeholder="Type, meal, note, location…"
                class="flex-1 bg-transparent text-xs outline-none placeholder:text-sky-300/70"
                @keyup.enter="load"
              />
            </div>
          </div>

          <!-- Status -->
          <div class="w-40">
            <label class="mb-1 block text-[11px] font-medium text-sky-100">
              Status
            </label>
            <select
              v-model="status"
              class="w-full rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-xs text-sky-50 outline-none"
            >
              <option v-for="s in statuses" :key="s" :value="s">
                {{ s === 'NEW' ? 'Pending' : s }}
              </option>
            </select>
          </div>

          <!-- Eat date -->
          <div class="w-44">
            <label class="mb-1 block text-[11px] font-medium text-sky-100">
              Eat date
            </label>
            <input
              v-model="filterDate"
              type="date"
              class="w-full rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-xs text-sky-50 outline-none"
            />
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[11px] uppercase tracking-[0.2em] text-sky-200">
              My meal requests
            </p>
            <p class="text-sm font-semibold">
              Today &amp; upcoming orders
            </p>
          </div>

          <div class="space-y-1">
            <label class="mb-1 block text-[11px] font-medium text-sky-100">
              Search
            </label>
            <div class="flex items-center rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-xs">
              <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-200/80" />
              <input
                v-model="q"
                type="text"
                placeholder="Type, meal, note, location…"
                class="flex-1 bg-transparent text-xs outline-none placeholder:text-sky-300/70"
                @keyup.enter="load"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <label class="block text-[11px] font-medium text-sky-100">
                Status
              </label>
              <select
                v-model="status"
                class="w-full rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-[11px] text-sky-50 outline-none"
              >
                <option v-for="s in statuses" :key="s + '-m'" :value="s">
                  {{ s === 'NEW' ? 'Pending' : s }}
                </option>
              </select>
            </div>

            <div class="space-y-1">
              <label class="block text-[11px] font-medium text-sky-100">
                Eat date
              </label>
              <input
                v-model="filterDate"
                type="date"
                class="w-full rounded-xl border border-sky-400 bg-sky-900/40 px-2.5 py-1.5 text-[11px] text-sky-50 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"></div>
          <div
            v-for="i in 3"
            :key="'sk-' + i"
            class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"
          ></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE -->
          <div v-if="isMobile" class="space-y-2">
            <p
              v-if="!pagedRows.length"
              class="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
            >
              No requests found.
            </p>

            <article
              v-for="r in pagedRows"
              :key="r._id"
              :data-row-id="r._id"
              class="rounded-2xl border border-slate-400 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.16)]
                     dark:border-slate-700 dark:bg-slate-900/95"
              :class="{ 'opacity-70': r.status === 'CANCELED' }"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px]
                           font-semibold border"
                    :class="statusBadgeClass(r.status)"
                  >
                    {{ statusLabel(r.status) }}
                  </span>
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ fmtDate(r.orderDate) }} → {{ fmtDate(r.eatDate) }}
                  </div>

                  <p v-if="canEmployeeCancel(r)" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    You can cancel only before it is accepted.
                  </p>
                </div>

                <div class="text-right">
                  <div class="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    {{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ r.orderType }}
                  </div>

                  <!-- Cancel button (only when NEW) -->
                  <button
                    v-if="canEmployeeCancel(r)"
                    type="button"
                    class="mt-2 inline-flex items-center gap-1 rounded-full border border-rose-600
                           bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white
                           hover:bg-rose-500"
                    @click="openConfirmCancel(r)"
                  >
                    <i class="fa-solid fa-ban text-[11px]" />
                    Cancel request
                  </button>
                </div>
              </div>

              <div class="mt-2 h-px bg-slate-300 dark:bg-slate-600" />

              <dl class="mt-2 space-y-1.5">
                <div class="flex gap-2">
                  <dt class="min-w-[70px] text-[11px] text-slate-500 dark:text-slate-400">
                    Meal(s)
                  </dt>
                  <dd class="flex-1 text-[13px] font-medium">
                    <span :class="{ 'line-through text-slate-400': r.status === 'CANCELED' }">
                      {{ (r.meals || []).join(', ') || '—' }}
                    </span>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      Qty: {{ r.quantity }}
                    </div>
                  </dd>
                </div>

                <div class="flex gap-2">
                  <dt class="min-w-[70px] text-[11px] text-slate-500 dark:text-slate-400">
                    Location
                  </dt>
                  <dd class="flex-1 text-[13px] font-medium">
                    <span :class="{ 'line-through text-slate-400': r.status === 'CANCELED' }">
                      {{ r?.location?.kind || '—' }}
                      <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                    </span>
                  </dd>
                </div>

                <div class="flex gap-2">
                  <dt class="min-w-[70px] text-[11px] text-slate-500 dark:text-slate-400">
                    Note
                  </dt>
                  <dd class="flex-1 text-[13px] font-medium">
                    <span :class="{ 'line-through text-slate-400': r.status === 'CANCELED' }">
                      {{ r.specialInstructions || '—' }}
                    </span>
                  </dd>
                </div>
              </dl>

              <div class="mt-2 flex justify-end">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-sky-500 px-2.5 py-1
                         text-[11px] font-medium text-sky-700 hover:bg-sky-50
                         dark:border-sky-500 dark:text-sky-300 dark:hover:bg-sky-900/60"
                  @click="toggleExpanded(r._id)"
                >
                  <i
                    :class="[
                      'fa-solid text-[11px]',
                      isExpanded(r._id) ? 'fa-chevron-up' : 'fa-chevron-down'
                    ]"
                  />
                  <span>{{ isExpanded(r._id) ? 'Hide details' : 'Details' }}</span>
                </button>
              </div>

              <transition name="details-fade">
                <div
                  v-if="isExpanded(r._id)"
                  class="mt-2 rounded-xl border border-slate-400 bg-slate-50/80 p-2 text-[11px]
                         dark:border-slate-600 dark:bg-slate-900/70"
                >
                  <div class="tree">
                    <div class="tree-node root">
                      <div class="node-label">
                        <strong>Qty</strong> {{ r.quantity }}
                      </div>
                      <div class="children">
                        <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
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
                                v-for="[allergen, aCnt] in Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries())"
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
            </article>
          </div>

          <!-- DESKTOP -->
          <div v-else class="overflow-x-auto">
            <table class="min-w-full border-collapse text-xs border border-slate-400 dark:border-slate-700">
              <thead>
                <tr class="border-b border-slate-400 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/80">
                  <th class="table-th">Status</th>
                  <th class="table-th">Actions</th>
                  <th class="table-th">Details</th>
                  <th class="table-th">Order Date</th>
                  <th class="table-th">Eat Date</th>
                  <th class="table-th">Time</th>
                  <th class="table-th">Order Type</th>
                  <th class="table-th">Meal(s)</th>
                  <th class="table-th">Qty</th>
                  <th class="table-th">Location</th>
                </tr>
              </thead>

              <tbody>
                <template v-for="r in pagedRows" :key="r._id">
                  <tr
                    :data-row-id="r._id"
                    class="border-b border-slate-300 text-[12px] hover:bg-slate-50/80
                           dark:border-slate-700 dark:hover:bg-slate-900/70"
                    :class="{ 'opacity-70': r.status === 'CANCELED' }"
                  >
                    <td class="table-td">
                      <span
                        class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border"
                        :class="statusBadgeClass(r.status)"
                      >
                        {{ statusLabel(r.status) }}
                      </span>
                    </td>

                    <td class="table-td">
                      <div class="flex items-center gap-2">
                        <button
                          v-if="canEmployeeCancel(r)"
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-rose-600
                                 bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white
                                 hover:bg-rose-500"
                          @click="openConfirmCancel(r)"
                          title="You can cancel only before it is accepted."
                        >
                          <i class="fa-solid fa-ban text-[11px]" />
                          Cancel request
                        </button>

                        <span v-else class="text-[11px] text-slate-500 dark:text-slate-400">
                          —
                        </span>
                      </div>
                    </td>

                    <td class="table-td">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-sky-500 px-2.5 py-1
                               text-[11px] font-medium text-sky-700 hover:bg-sky-50
                               dark:border-sky-500 dark:text-sky-300 dark:hover:bg-sky-900/60"
                        @click="toggleExpanded(r._id)"
                      >
                        <i
                          :class="[
                            'fa-solid text-[11px]',
                            isExpanded(r._id) ? 'fa-chevron-up' : 'fa-chevron-down'
                          ]"
                        />
                        <span>{{ isExpanded(r._id) ? 'Hide details' : 'Details' }}</span>
                      </button>

                      <div v-if="canEmployeeCancel(r)" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Cancel available before accepted.
                      </div>
                    </td>

                    <td class="table-td">{{ fmtDate(r.orderDate) }}</td>
                    <td class="table-td">{{ fmtDate(r.eatDate) }}</td>
                    <td class="table-td">
                      {{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                    </td>
                    <td class="table-td">{{ r.orderType }}</td>

                    <td class="table-td">
                      <span :class="{ 'line-through text-slate-400': r.status === 'CANCELED' }">
                        {{ (r.meals || []).join(', ') || '—' }}
                      </span>
                    </td>

                    <td class="table-td">{{ r.quantity }}</td>

                    <td class="table-td">
                      <span :class="{ 'line-through text-slate-400': r.status === 'CANCELED' }">
                        {{ r?.location?.kind || '—' }}
                        <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                      </span>
                    </td>
                  </tr>

                  <tr
                    v-if="isExpanded(r._id)"
                    class="border-b border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-950/60"
                  >
                    <td class="px-3 py-2" colspan="10">
                      <div class="grid gap-2">
                        <div class="rounded-xl border border-slate-300 bg-white p-2 text-[11px] dark:border-slate-700 dark:bg-slate-950">
                          <div class="font-semibold text-slate-800 dark:text-slate-100">Note</div>
                          <div class="text-slate-600 dark:text-slate-300">
                            {{ r.specialInstructions || '—' }}
                          </div>
                        </div>

                        <div class="tree text-[11px] border border-slate-400 rounded-xl p-2 dark:border-slate-600">
                          <div class="tree-node root">
                            <div class="node-label">
                              <strong>Qty</strong> {{ r.quantity }}
                            </div>
                            <div class="children">
                              <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
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
                                      v-for="[allergen, aCnt] in Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries())"
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
                    </td>
                  </tr>
                </template>

                <tr v-if="!rows.length && !loading">
                  <td
                    colspan="10"
                    class="px-3 py-6 text-center text-[12px] text-slate-500
                           border-t border-slate-300
                           dark:text-slate-400 dark:border-slate-700"
                  >
                    No requests found.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            class="mt-3 flex flex-col gap-2 border-t border-slate-400 pt-2
                   text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300
                   sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="itemsPerPage"
                class="rounded-lg border border-slate-400 bg-white px-2 py-1
                       text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option v-for="opt in itemsPerPageOptions" :key="'ipp-' + opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">
                Prev
              </button>
              <span class="px-2">Page {{ page }} / {{ pageCount }}</span>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">
                Next
              </button>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm cancel modal (NO reason) -->
    <transition name="details-fade">
      <div v-if="confirmModalOpen" class="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="closeConfirmCancel" />
        <div
          class="relative w-full max-w-md rounded-2xl border border-slate-300 bg-white p-4 shadow-xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Cancel this meal request?
          </h3>
          <p class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
            Are you sure you want to cancel? Chef/Admin will not prepare it.
          </p>

          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-semibold
                     hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
              :disabled="canceling"
              @click="closeConfirmCancel"
            >
              No
            </button>

            <button
              type="button"
              class="rounded-xl border border-rose-600 bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white
                     hover:bg-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="canceling"
              @click="confirmCancel"
            >
              <span v-if="canceling">Canceling…</span>
              <span v-else>Yes, cancel</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.highlight-row {
  animation: rowFlash 5s ease-in-out;
}
@keyframes rowFlash {
  0% { background-color: #fef9c3; }
  50% { background-color: #fef08a; }
  100% { background-color: transparent; }
}

/* details transition */
.details-fade-enter-active,
.details-fade-leave-active {
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
.details-fade-enter-from,
.details-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* table helpers */
.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
  border-left: 1px solid #cbd5e1;
}
.table-th:first-child { border-left: none; }

.table-td {
  padding: 8px 10px;
  vertical-align: top;
  border-left: 1px solid #cbd5e1;
}
.table-td:first-child { border-left: none; }

/* tree layout */
.tree { line-height: 1.4; }
.tree .node-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.5rem;
  background: rgba(59, 130, 246, 0.12);
}
.tree .root > .node-label { background: rgba(16, 185, 129, 0.18); }
.tree .leaf .node-label { background: rgba(234, 179, 8, 0.16); }

.children {
  margin-left: 1.2rem;
  padding-left: 0.6rem;
  border-left: 2px dashed rgba(148, 163, 184, 0.95);
  margin-top: 0.35rem;
}
.arrow { font-weight: 700; }
.arrow.small { opacity: 0.9; }

/* pagination */
.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pagination-btn:not(:disabled):hover { background: #e5edff; }

.dark .pagination-btn {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.9);
  color: #e5e7eb;
}
.dark .pagination-btn:not(:disabled):hover { background: #1e293b; }
</style>
