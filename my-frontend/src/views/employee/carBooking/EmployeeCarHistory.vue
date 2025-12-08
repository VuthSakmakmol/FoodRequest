<!-- src/employee/carbooking/EmployeeCarHistory.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const toast = useToast()

/* ───────────────── Focus from calendar ───────────────── */
const focusId   = ref(route.query.focus || '')
const focusDate = ref(route.query.date || '')

/* ───────────────── Responsive flag (no Vuetify) ───────────────── */
const isMobile = ref(false)
function handleResize () {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 960
}

/* ───────────────── State ───────────────── */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate   = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter   = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch        = ref('')

const meId = ref(localStorage.getItem('employeeId') || '')

/* cancel state */
const cancelLoading = ref('')
const confirmOpen   = ref(false)
const confirmItem   = ref(null)

/* ───────────────── Build absolute URL for uploads ───────────────── */
const API_ORIGIN = (api.defaults.baseURL || '')
  .replace(/\/api\/?$/,'')
  .replace(/\/$/,'')
function absUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`
}
function openTicket(u){
  const url = absUrl(u)
  if (url && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/* ───────────────── Scroll highlight from calendar ───────────────── */
function scrollToBooking(id) {
  setTimeout(() => {
    const el = document.querySelector(`[data-row-id="${id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-row')
      setTimeout(() => el.classList.remove('highlight-row'), 2500)
    }
  }, 400)
}

/* ───────────────── Helpers ───────────────── */
function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination)
    .join(' → ')
}

const statusIconFA = s => ({
  PENDING:   'fa-solid fa-hourglass-half',
  ACCEPTED:  'fa-solid fa-circle-check',
  ON_ROAD:   'fa-solid fa-truck-fast',
  ARRIVING:  'fa-solid fa-flag-checkered',
  COMPLETED: 'fa-solid fa-circle-check',
  DELAYED:   'fa-solid fa-triangle-exclamation',
  CANCELLED: 'fa-solid fa-ban'
}[s] || 'fa-solid fa-hourglass-half')

function fixFA(icon) {
  return icon === 'fa-solid fa-badge-check'
    ? 'fa-solid fa-circle-check'
    : icon
}

const categoryIconFA = cat => (cat === 'Car' ? 'fa-solid fa-car' : 'fa-solid fa-motorcycle')
const stopIconFA     = dest => (dest === 'Airport' ? 'fa-solid fa-plane' : 'fa-solid fa-location-dot')

const statusClass = s => {
  const k = String(s || '').toUpperCase()
  switch (k) {
    case 'PENDING':
      return 'bg-slate-100 text-slate-700 border border-slate-200'
    case 'ACCEPTED':
      return 'bg-sky-100 text-sky-800 border border-sky-200'
    case 'ON_ROAD':
      return 'bg-amber-100 text-amber-800 border border-amber-200'
    case 'ARRIVING':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border border-green-200'
    case 'DELAYED':
      return 'bg-orange-100 text-orange-800 border border-orange-200'
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-800 border border-rose-200'
    default:
      return 'bg-slate-100 text-slate-800 border border-slate-200'
  }
}

const categoryClass = cat =>
  cat === 'Car'
    ? 'bg-sky-100 text-sky-800 border border-sky-200'
    : 'bg-amber-100 text-amber-800 border border-amber-200'

/* ───────────────── Load schedule (same endpoint as before) ───────────────── */
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = { date: selectedDate.value }
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      isMine: meId.value && String(x.employeeId) === String(meId.value),
    }))
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Failed to load schedule'
    error.value = msg
    toast.error?.(msg) ?? console.error(msg)
  } finally {
    loading.value = false
  }
}

/* ───────────────── Filters / search / sort ───────────────── */
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name, r.employee?.department, r.employeeId,
        r.purpose, r.notes, prettyStops(r.stops)
      ].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

/* ───────────────── Cancel rules ───────────────── */
function canCancel(item) {
  const st = String(item.status || '').toUpperCase()
  if (['ON_ROAD','ARRIVING','COMPLETED','CANCELLED'].includes(st)) return false

  if (!item.tripDate) return true
  const tripDay = dayjs(item.tripDate).startOf('day')
  const today   = dayjs().startOf('day')
  return tripDay.isSame(today, 'day') || tripDay.isAfter(today, 'day')
}

function askCancel(item) {
  if (!item?._id || !item.isMine || !canCancel(item)) return
  confirmItem.value = item
  confirmOpen.value = true
}

async function confirmCancel() {
  const item = confirmItem.value
  if (!item?._id) return
  confirmOpen.value = false
  cancelLoading.value = String(item._id)
  try {
    await api.post(`/employee/car-bookings/${item._id}/cancel`)
    item.status = 'CANCELLED'
    toast.success?.('Your booking has been cancelled.')
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Failed to cancel booking'
    error.value = msg
    toast.error?.(msg)
    await loadSchedule()
  } finally {
    cancelLoading.value = ''
    confirmItem.value = null
  }
}

/* ───────────────── Socket events ───────────────── */
function onCreated(doc) {
  if (!doc?.tripDate || doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) {
    rows.value.push({
      ...doc,
      isMine: meId.value && String(doc.employeeId) === String(meId.value),
      stops: doc.stops || []
    })
  }
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

/* ───────────────── Mounted / unmounted ───────────────── */
onMounted(() => {
  handleResize()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize)
  }

  if (focusDate.value) selectedDate.value = focusDate.value
  loadSchedule().then(() => {
    if (focusId.value) scrollToBooking(focusId.value)
  })
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleResize)
  }
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
})

watch([selectedDate, statusFilter], loadSchedule)

/* ───────────────── Details modal ───────────────── */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }

/* ───────────────── Pagination ───────────────── */
const page         = ref(1)
const itemsPerPage = ref(10)

const totalItems = computed(() => filtered.value?.length || 0)
const pageCount  = computed(() => {
  const per = itemsPerPage.value || 10
  return Math.max(1, Math.ceil(totalItems.value / per) || 1)
})

const pagedItems = computed(() => {
  const per = itemsPerPage.value || totalItems.value || 1
  const start = (page.value - 1) * per
  return (filtered.value || []).slice(start, start + per)
})

const rangeStart = computed(() =>
  totalItems.value ? (page.value - 1) * (itemsPerPage.value || 10) + 1 : 0
)
const rangeEnd   = computed(() =>
  Math.min(page.value * (itemsPerPage.value || 10), totalItems.value)
)

watch([filtered, itemsPerPage], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

function goFirst () { page.value = 1 }
function goPrev  () { page.value = Math.max(1, page.value - 1) }
function goNext  () { page.value = Math.min(pageCount.value, page.value + 1) }
function goLast  () { page.value = pageCount.value }
</script>

<template>
  <div class="px-2 pb-4 text-slate-900 dark:text-slate-100">
    <div
      class="section rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm
             dark:border-slate-700 dark:bg-slate-900/80"
    >
      <!-- Hero header -->
      <header
        class="hero flex items-center justify-between rounded-t-2xl
               bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
               px-4 py-3 text-white"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2 text-sm font-semibold">
            <i class="fa-solid fa-calendar-check text-xs"></i>
            <span>Day Schedule — All Requests</span>
          </div>
          <p class="text-[11px] opacity-90">
            View your booking and all company trips for the selected day.
          </p>
        </div>

        <div class="hidden items-center gap-2 text-[11px] md:flex">
          <span
            class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-800"
          >
            <span class="h-2 w-2 rounded-full bg-sky-500"></span>
            Mine
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700"
          >
            <span class="h-2 w-2 rounded-full bg-slate-400"></span>
            Others
          </span>
        </div>
      </header>

      <!-- Body -->
      <div class="space-y-3 bg-slate-50/60 p-3 dark:bg-slate-900/70">
        <!-- Filters -->
        <div
          class="filters-card rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm
                 dark:border-slate-700 dark:bg-slate-950/80"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold">
              <i class="fa-solid fa-filter text-[11px]"></i>
              <span>Filters</span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-slate-800"
              @click="loadSchedule"
            >
              <i
                v-if="!loading"
                class="fa-solid fa-rotate-right text-[11px]"
              ></i>
              <i
                v-else
                class="fa-solid fa-spinner animate-spin text-[11px]"
              ></i>
              <span>Refresh</span>
            </button>
          </div>

          <div class="grid gap-2 text-[11px] md:grid-cols-4">
            <div class="flex flex-col gap-1">
              <label class="font-semibold text-slate-700 dark:text-slate-100">Date</label>
              <input
                v-model="selectedDate"
                type="date"
                class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="font-semibold text-slate-700 dark:text-slate-100">Status</label>
              <select
                v-model="statusFilter"
                class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="ON_ROAD">On road</option>
                <option value="ARRIVING">Arriving</option>
                <option value="COMPLETED">Completed</option>
                <option value="DELAYED">Delayed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="font-semibold text-slate-700 dark:text-slate-100">Category</label>
              <select
                v-model="categoryFilter"
                class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All</option>
                <option value="Car">Car</option>
                <option value="Messenger">Messenger</option>
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="font-semibold text-slate-700 dark:text-slate-100">
                Search requester / purpose / destination
              </label>
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-400">
                  <i class="fa-solid fa-magnifying-glass text-[10px]"></i>
                </span>
                <input
                  v-model="qSearch"
                  type="text"
                  class="h-9 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-xs
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  placeholder="Type to search…"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div
          v-if="error"
          class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ error }}
        </div>

        <!-- Main content card -->
        <div
          class="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm
                 dark:border-slate-700 dark:bg-slate-950/80"
        >
          <!-- Desktop table -->
          <div v-if="!isMobile" class="hidden md:block">
            <div class="overflow-x-auto">
              <table class="min-w-full text-xs">
                <thead class="border-b border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/60">
                  <tr class="text-[11px] uppercase tracking-wide text-slate-500">
                    <th class="px-3 py-2 text-left">Time</th>
                    <th class="px-3 py-2 text-left">Category</th>
                    <th class="px-3 py-2 text-left">Requester</th>
                    <th class="px-3 py-2 text-left">Itinerary</th>
                    <th class="px-3 py-2 text-center">Pax</th>
                    <th class="px-3 py-2 text-left">Status</th>
                    <th class="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="loading">
                    <td colspan="7" class="px-3 py-4 text-center text-[11px] text-slate-500">
                      <i class="fa-solid fa-spinner animate-spin"></i>
                      <span class="ml-2">Loading schedule…</span>
                    </td>
                  </tr>

                  <tr
                    v-for="item in !loading ? pagedItems : []"
                    :key="item._id"
                    :data-row-id="item._id"
                    class="border-b border-slate-100 text-[11px] hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/60"
                    @click="showDetails(item)"
                  >
                    <td class="px-3 py-2 font-mono text-[11px]">
                      {{ item.timeStart }} – {{ item.timeEnd }}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        :class="[
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          categoryClass(item.category)
                        ]"
                      >
                        <i :class="categoryIconFA(item.category)" class="text-[11px]"></i>
                        {{ item.category }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex items-center gap-2">
                        <span
                          v-if="item.isMine"
                          class="inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                        >
                          Mine
                        </span>
                        <div>
                          <div class="text-[11px] font-semibold">
                            {{ item.employee?.name || '—' }}
                          </div>
                          <div class="text-[11px] text-slate-500">
                            {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="px-3 py-2">
                      <div class="line-clamp-2 text-[11px]">
                        {{ prettyStops(item.stops) }}
                        <button
                          v-if="item.ticketUrl"
                          type="button"
                          class="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          @click.stop="openTicket(item.ticketUrl)"
                        >
                          <i class="fa-solid fa-paperclip text-[10px]"></i>
                          Ticket
                        </button>
                      </div>
                      <div
                        v-if="item.purpose || item.notes"
                        class="mt-1 text-[11px] text-slate-500"
                      >
                        <span class="font-semibold">Purpose:</span>
                        {{ item.purpose || '—' }}
                        <span v-if="item.notes">
                          • <span class="font-semibold">Notes:</span> {{ item.notes }}
                        </span>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-center text-[11px]">
                      {{ item.passengers ?? 1 }}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        :class="[
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          statusClass(item.status)
                        ]"
                      >
                        <i :class="fixFA(statusIconFA(item.status))" class="text-[11px]"></i>
                        {{ item.status }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex justify-end gap-2 text-[11px]">
                        <button
                          v-if="item.isMine"
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold
                                 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          :disabled="!canCancel(item) || cancelLoading === String(item._id)"
                          @click.stop="askCancel(item)"
                        >
                          <i
                            v-if="cancelLoading === String(item._id)"
                            class="fa-solid fa-spinner animate-spin text-[10px]"
                          ></i>
                          <i
                            v-else
                            class="fa-solid fa-ban text-[10px]"
                          ></i>
                          <span>Cancel</span>
                        </button>

                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                          @click.stop="showDetails(item)"
                        >
                          <i class="fa-solid fa-circle-info text-[10px]"></i>
                          <span>Details</span>
                        </button>
                      </div>
                    </td>
                  </tr>

                  <tr v-if="!loading && !filtered.length">
                    <td colspan="7" class="px-3 py-4 text-center text-[11px] text-slate-500">
                      No bookings found.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Desktop footer -->
            <div
              class="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[11px] text-slate-600 dark:border-slate-800"
            >
              <div>
                Showing {{ rangeStart }}–{{ rangeEnd }} of {{ totalItems }}
              </div>

              <div class="flex items-center gap-2">
                <span class="hidden md:inline">Rows per page:</span>
                <select
                  v-model.number="itemsPerPage"
                  class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[11px]
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                </select>
              </div>

              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === 1"
                  @click="goFirst"
                >
                  <i class="fa-solid fa-angles-left text-[10px]"></i>
                </button>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === 1"
                  @click="goPrev"
                >
                  <i class="fa-solid fa-angle-left text-[10px]"></i>
                </button>
                <span class="px-1 text-[11px]">
                  Page {{ page }} / {{ pageCount }}
                </span>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === pageCount"
                  @click="goNext"
                >
                  <i class="fa-solid fa-angle-right text-[10px]"></i>
                </button>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === pageCount"
                  @click="goLast"
                >
                  <i class="fa-solid fa-angles-right text-[10px]"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile card list -->
          <div v-else class="space-y-3 md:hidden">
            <div v-if="loading" class="py-4 text-center text-[11px] text-slate-500">
              <i class="fa-solid fa-spinner animate-spin"></i>
              <span class="ml-2">Loading schedule…</span>
            </div>

            <div
              v-for="item in !loading ? pagedItems : []"
              :key="item._id"
              :data-row-id="item._id"
              class="booking-card cursor-pointer"
              @click="showDetails(item)"
            >
              <!-- top row -->
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[12px] font-mono font-semibold text-slate-900">
                    {{ item.timeStart }} – {{ item.timeEnd }}
                  </div>
                  <div class="mt-0.5 text-[10px] text-slate-500">
                    {{ item.tripDate || '—' }}
                  </div>
                </div>

                <span
                  :class="[
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    statusClass(item.status)
                  ]"
                >
                  <i :class="fixFA(statusIconFA(item.status))" class="text-[10px]"></i>
                  {{ item.status }}
                </span>
              </div>

              <!-- middle -->
              <div class="mt-2 flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 text-[10px]">
                  <span
                    :class="[
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      categoryClass(item.category)
                    ]"
                  >
                    <i :class="categoryIconFA(item.category)" class="text-[10px]"></i>
                    {{ item.category }}
                  </span>

                  <span
                    v-if="item.isMine"
                    class="inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                  >
                    Mine
                  </span>
                </div>

                <div class="text-right text-[10px]">
                  <div class="font-semibold">
                    {{ item.employee?.name || '—' }}
                  </div>
                  <div class="text-slate-500">
                    {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                  </div>
                </div>
              </div>

              <!-- body -->
              <div class="mt-2 text-[10px] text-slate-700">
                <div class="font-semibold text-slate-600">Route</div>
                <div class="mt-0.5">
                  {{ prettyStops(item.stops) }}
                  <button
                    v-if="item.ticketUrl"
                    type="button"
                    class="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                    @click.stop="openTicket(item.ticketUrl)"
                  >
                    <i class="fa-solid fa-paperclip text-[10px]"></i>
                    Ticket
                  </button>
                </div>

                <div
                  v-if="item.purpose || item.notes"
                  class="mt-1 text-[10px] text-slate-500"
                >
                  <span class="font-semibold">Purpose:</span>
                  {{ item.purpose || '—' }}
                  <span v-if="item.notes">
                    • <span class="font-semibold">Notes:</span> {{ item.notes }}
                  </span>
                </div>
              </div>

              <!-- bottom -->
              <div class="mt-2 flex items-center justify-between gap-2 text-[10px]">
                <div class="text-slate-500">
                  Pax: <span class="font-semibold text-slate-800">{{ item.passengers ?? 1 }}</span>
                </div>

                <div class="flex items-center gap-1">
                  <button
                    v-if="item.isMine"
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold
                           text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!canCancel(item) || cancelLoading === String(item._id)"
                    @click.stop="askCancel(item)"
                  >
                    <i
                      v-if="cancelLoading === String(item._id)"
                      class="fa-solid fa-spinner animate-spin text-[9px]"
                    ></i>
                    <i
                      v-else
                      class="fa-solid fa-ban text-[9px]"
                    ></i>
                    <span>Cancel</span>
                  </button>

                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
                    @click.stop="showDetails(item)"
                  >
                    <i class="fa-solid fa-circle-info text-[9px]"></i>
                    <span>Details</span>
                  </button>
                </div>
              </div>
            </div>

            <div
              v-if="!loading && !filtered.length"
              class="py-4 text-center text-[11px] text-slate-500"
            >
              No bookings found.
            </div>

            <!-- mobile footer -->
            <div
              v-if="pageCount > 1"
              class="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-600 dark:border-slate-800"
            >
              <div>
                {{ page }} / {{ pageCount }} ({{ totalItems }} items)
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === 1"
                  @click="goFirst"
                >
                  <i class="fa-solid fa-angles-left text-[10px]"></i>
                </button>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === 1"
                  @click="goPrev"
                >
                  <i class="fa-solid fa-angle-left text-[10px]"></i>
                </button>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === pageCount"
                  @click="goNext"
                >
                  <i class="fa-solid fa-angle-right text-[10px]"></i>
                </button>
                <button
                  type="button"
                  class="nav-btn"
                  :disabled="page === pageCount"
                  @click="goLast"
                >
                  <i class="fa-solid fa-angles-right text-[10px]"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Details modal -->
    <div
      v-if="detailOpen && detailItem"
      class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-3"
      @click.self="detailOpen = false"
    >
      <div
        class="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl
               dark:border-slate-700 dark:bg-slate-950"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span
              :class="[
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                categoryClass(detailItem.category)
              ]"
            >
              <i :class="categoryIconFA(detailItem.category)" class="text-[11px]"></i>
              {{ detailItem.category || '—' }}
            </span>
            <span class="font-mono text-[11px]">
              {{ detailItem.timeStart }} – {{ detailItem.timeEnd }}
            </span>
          </div>
          <button
            type="button"
            class="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            @click="detailOpen = false"
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>

        <div class="grid gap-3 text-[11px] md:grid-cols-2">
          <div>
            <div class="lbl">Date</div>
            <div class="val">
              {{ detailItem.tripDate || '—' }}
            </div>
          </div>
          <div>
            <div class="lbl">Passengers</div>
            <div class="val">
              {{ detailItem.passengers ?? 1 }}
            </div>
          </div>

          <div>
            <div class="lbl">Requester</div>
            <div class="val">
              {{ detailItem.employee?.name || '—' }}
              <div class="text-[11px] text-slate-500">
                {{ detailItem.employee?.department || '—' }} • ID {{ detailItem.employeeId }}
              </div>
            </div>
          </div>

          <div v-if="detailItem.customerContact">
            <div class="lbl">Customer Contact</div>
            <div class="val">
              {{ detailItem.customerContact }}
            </div>
          </div>

          <div class="md:col-span-2">
            <div class="lbl">Itinerary</div>
            <div class="val">
              <div
                v-if="(detailItem.stops || []).length"
                class="space-y-1"
              >
                <div
                  v-for="(s,i) in detailItem.stops"
                  :key="i"
                  class="flex flex-wrap items-center gap-2 text-[11px]"
                >
                  <i :class="stopIconFA(s.destination)" class="text-[10px]"></i>
                  <strong>#{{ i+1 }}:</strong>
                  <span>
                    {{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}
                  </span>
                  <a
                    v-if="s.mapLink"
                    :href="absUrl(s.mapLink)"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800"
                  >
                    <i class="fa-solid fa-link text-[9px]"></i>
                    Map
                  </a>
                </div>
              </div>
              <div v-else>—</div>
            </div>
          </div>

          <div>
            <div class="lbl">Status</div>
            <div class="val">
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  statusClass(detailItem.status)
                ]"
              >
                <i :class="fixFA(statusIconFA(detailItem.status))" class="text-[11px]"></i>
                {{ detailItem.status || '—' }}
              </span>
            </div>
          </div>

          <div v-if="detailItem.ticketUrl">
            <div class="lbl">Ticket</div>
            <div class="val">
              <a
                :href="absUrl(detailItem.ticketUrl)"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
              >
                <i class="fa-solid fa-paperclip text-[10px]"></i>
                View ticket
              </a>
            </div>
          </div>

          <div
            v-if="detailItem.purpose || detailItem.notes"
            class="md:col-span-2"
          >
            <div class="lbl">Purpose &amp; Notes</div>
            <div class="val space-y-1">
              <div>
                <span class="font-semibold text-slate-600 dark:text-slate-200">Purpose:</span>
                {{ detailItem.purpose || '—' }}
              </div>
              <div v-if="detailItem.notes">
                <span class="font-semibold text-slate-600 dark:text-slate-200">Notes:</span>
                {{ detailItem.notes }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded-full px-4 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="detailOpen = false"
          >
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- Cancel confirm modal -->
    <div
      v-if="confirmOpen && confirmItem"
      class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-3"
      @click.self="confirmOpen = false"
    >
      <div
        class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl
               dark:border-slate-700 dark:bg-slate-950"
      >
        <h3 class="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
          <i class="fa-solid fa-triangle-exclamation text-amber-500"></i>
          Cancel this booking?
        </h3>
        <p class="mb-3 text-[11px] text-slate-600 dark:text-slate-300">
          This will mark your booking as <strong>Cancelled</strong>. Drivers and admins
          will see the updated status.
        </p>

        <div class="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:bg-slate-900/70">
          <div class="font-mono">
            {{ confirmItem.timeStart }} – {{ confirmItem.timeEnd }}
          </div>
          <div class="text-[11px]">
            {{ confirmItem.tripDate }}
          </div>
          <div class="mt-1 text-[11px]">
            <span class="font-semibold">Route:</span>
            {{ prettyStops(confirmItem.stops) }}
          </div>
        </div>

        <div class="flex justify-end gap-2 text-[11px]">
          <button
            type="button"
            class="rounded-full px-4 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="confirmOpen = false"
          >
            Keep booking
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-1.5 font-semibold text-white hover:bg-rose-500"
            @click="confirmCancel"
          >
            <i class="fa-solid fa-ban text-[10px]"></i>
            <span>Cancel booking</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section {
  background: radial-gradient(circle at 0 0, rgba(56,189,248,0.10), transparent 55%),
              radial-gradient(circle at 100% 100%, rgba(129,140,248,0.10), transparent 55%),
              rgba(248,250,252,0.9);
}

/* labels / values in details */
.lbl {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 2px;
}
.val {
  font-size: 0.78rem;
  font-weight: 600;
}

/* booking card for mobile */
.booking-card {
  position: relative;
  border-radius: 16px;
  padding: 10px 12px 12px;
  border: 1px solid rgba(148,163,184,0.5);
  background:
    radial-gradient(circle at 0 0, rgba(59,130,246,0.14), transparent 60%),
    radial-gradient(circle at 100% 100%, rgba(129,140,248,0.16), transparent 55%),
    rgba(255,255,255,0.96);
  box-shadow: 0 10px 24px rgba(15,23,42,0.10);
  backdrop-filter: blur(10px);
}

/* left color strip */
.booking-card::before{
  content:'';
  position:absolute;
  left:0;
  top:10px;
  bottom:10px;
  width:3px;
  border-radius:999px;
  background:linear-gradient(180deg,#0f719e,#22c55e);
}

/* nav buttons */
.nav-btn {
  @apply inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800;
}

/* highlight animation when focused from calendar */
.highlight-row {
  animation: rowFlash 2.2s ease-in-out;
}
@keyframes rowFlash {
  0%   { background-color: #fef9c3; }
  50%  { background-color: #fef08a; }
  100% { background-color: transparent; }
}
</style>
