<!-- src/views/admin/transport/TransportAdminCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useAuth } from '@/store/auth'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const auth   = useAuth()
const { showToast } = useToast()

/* ───────── Status colors (car booking) ───────── */
const STATUS_COLOR = {
  PENDING:   '#94a3b8',
  ASSIGNED:  '#64748b',
  ACCEPTED:  '#3b82f6',
  ON_ROAD:   '#06b6d4',
  ARRIVING:  '#10b981',
  COMPLETED: '#16a34a',
  DELAYED:   '#facc15',
  CANCELLED: '#ef4444',
  DECLINED:  '#b91c1c',
}

/* ───────── state ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))

const loading   = ref(false)
const loadError = ref('')
const rows      = ref([]) // normalized car bookings

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const asArray = v => (Array.isArray(v) ? v : [])

const normalize = o => {
  const tripDate = o?.tripDate || o?.date || null
  return {
    ...o,
    _id: String(o?._id || ''),
    tripDate,
    timeStart: o?.timeStart || '',
    timeEnd: o?.timeEnd || '',
    status: o?.status || 'PENDING',
    category: o?.category || 'Car',
    passengers: Number(o?.passengers ?? 1),
    employee: o?.employee || {},
    assignment: o?.assignment || {},
    stops: asArray(o?.stops),
  }
}

/* readable destination from first stop */
const firstDestination = (r) => {
  if (!r?.stops?.length) return '—'
  const s = r.stops[0]
  if (!s) return '—'
  if (s.destination === 'Other') return s.destinationOther || 'Other'
  return s.destination || '—'
}

/* time range */
const fmtTimeRange = (r) =>
  (r?.timeStart || r?.timeEnd)
    ? [r.timeStart || '', r.timeEnd || ''].filter(Boolean).join(' – ')
    : '—'

/* assignee label */
const assigneeLabel = (r) => {
  const cat = r?.category || 'Car'
  if (cat === 'Messenger') {
    return r?.assignment?.messengerName || r?.assignment?.messengerId || 'Unassigned'
  }
  return r?.assignment?.driverName || r?.assignment?.driverId || 'Unassigned'
}

/* ───────── group by date ───────── */
const byDate = computed(() => {
  const map = {}
  for (const r of rows.value) {
    const key = fmtDate(r.tripDate)
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

function listForDate(dateStr) {
  const list = byDate.value[dateStr] || []
  return list.slice().sort((a, b) => {
    const tA = (a.timeStart || '') + (a.timeEnd || '')
    const tB = (b.timeStart || '') + (b.timeEnd || '')
    return (
      tA.localeCompare(tB) ||
      (a.status || '').localeCompare(b.status || '') ||
      (a.employee?.name || '').localeCompare(b.employee?.name || '')
    )
  })
}

/* panel for selected date */
const selectedList = computed(() => listForDate(selectedDate.value))

/* ───────── month grid (same style as AdminFoodCalendar) ───────── */
const monthLabel   = computed(() => currentMonth.value.format('MMMM YYYY'))
const startOfMonth = computed(() => currentMonth.value.startOf('month'))
const endOfMonth   = computed(() => currentMonth.value.endOf('month'))
const startOfGrid  = computed(() => startOfMonth.value.startOf('week')) // Sunday
const endOfGrid    = computed(() => endOfMonth.value.endOf('week'))

const days = computed(() => {
  const arr = []
  let d = startOfGrid.value
  while (d.isBefore(endOfGrid.value) || d.isSame(endOfGrid.value, 'day')) {
    arr.push(d)
    d = d.add(1, 'day')
  }
  return arr
})

/* ───────── API ───────── */
async function loadMonth () {
  loading.value = true
  loadError.value = ''
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    let { data } = await api.get('/admin/car-bookings', {
      params: { from, to }
    })

    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    // fallback: if backend ignores from/to and returns empty
    if (!Array.isArray(list) || list.length === 0) {
      const resp2 = await api.get('/admin/car-bookings')
      data = resp2.data
      list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    }

    rows.value = (list || []).map(normalize)
  } catch (e) {
    console.error('[TransportAdminCalendar] loadMonth error:', e)
    loadError.value =
      e?.response?.data?.message || e?.message || 'Failed to load car booking calendar.'
    rows.value = []
    showToast({
      type: 'error',
      title: 'Load failed',
      message: loadError.value,
      timeout: 2500,
    })
  } finally {
    loading.value = false
  }
}

/* ───────── realtime upsert/remove from socket ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(x => x._id === d._id)
  if (i === -1) rows.value.push(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const idx = rows.value.findIndex(x => x._id === id)
  if (idx !== -1) rows.value.splice(idx, 1)
}

/* ───────── navigation ───────── */
function nextMonth () {
  currentMonth.value = currentMonth.value.add(1, 'month')
}
function prevMonth () {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
}
function goToday () {
  currentMonth.value = dayjs()
  selectedDate.value = dayjs().format('YYYY-MM-DD')
}

/* ───────── click handlers ───────── */
function selectDay(d) {
  selectedDate.value = d.format('YYYY-MM-DD')
}

function openAdminListForSelected() {
  // Always allow open; if no bookings, just toast
  if (!selectedList.value.length) {
    showToast({
      type: 'info',
      title: 'No bookings',
      message: `No car bookings on ${selectedDate.value}.`,
      timeout: 2000,
    })
  }
  router.push({
    name: 'admin-car-booking',
    query: { date: selectedDate.value }
  })
}

function openRowInAdmin(r) {
  router.push({
    name: 'admin-car-booking',
    query: { date: selectedDate.value, focus: r._id }
  })
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  subscribeRoleIfNeeded({ role: 'ADMIN' })

  await loadMonth()

  socket.on('carBooking:created', (doc) => doc && upsertRow(doc))
  socket.on('carBooking:updated', (p) => p && p.booking && upsertRow(p.booking || p))
  socket.on('carBooking:status', (p) => {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (it) it.status = p.status
  })
  socket.on('carBooking:assigned', (p) => {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (!it) return
    it.assignment = {
      ...(it.assignment || {}),
      driverId: p.driverId ?? it.assignment?.driverId ?? '',
      driverName: p.driverName ?? it.assignment?.driverName ?? '',
      messengerId: p.messengerId ?? it.assignment?.messengerId ?? '',
      messengerName: p.messengerName ?? it.assignment?.messengerName ?? '',
    }
    if (p.status) it.status = p.status
    if (p.category) it.category = p.category
  })
  socket.on('carBooking:deleted', (p) => {
    const id = String(p?.bookingId || '')
    if (!id) return
    removeRowById(id)
  })
})

onBeforeUnmount(() => {
  socket.off('carBooking:created')
  socket.off('carBooking:updated')
  socket.off('carBooking:status')
  socket.off('carBooking:assigned')
  socket.off('carBooking:deleted')
})

watch(currentMonth, () => loadMonth())
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Toolbar -->
      <header
        class="flex flex-wrap items-center justify-between gap-2
               px-3 py-2
               rounded-t-2xl border-b border-slate-200
               bg-gradient-to-r from-[#0f719e] via-[#b3b4df] to-[#ae9aea]
               text-slate-900
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
      >
        <div class="flex items-center gap-2">
          <!-- Prev -->
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full
                  border border-slate-900/70 bg-white text-slate-900 text-base
                  shadow-sm hover:bg-slate-100"
            @click="prevMonth"
            aria-label="Previous month"
            title="Previous month"
          >
            ‹
          </button>

          <!-- Month label -->
          <div class="flex flex-col">
            <span class="text-sm sm:text-base font-semibold dark:text-slate-200/80">
              {{ monthLabel }}
            </span>
            <span class="text-[11px] text-slate-800/80 dark:text-slate-200/80">
              Tap a day to review car bookings
            </span>
          </div>

          <!-- Next -->
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full
                  border border-slate-900/70 bg-white text-slate-900 text-base
                  shadow-sm hover:bg-slate-100"
            @click="nextMonth"
            aria-label="Next month"
            title="Next month"
          >
            ›
          </button>
        </div>


        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-slate-100/70
                   bg-white/10 px-3 py-1.5 text-[11px] font-medium
                   hover:bg-white/20 dark:text-slate-200/80"
            @click="loadMonth"
          >
            Refresh
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-sky-200
                   bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white
                   hover:bg-sky-500"
            @click="goToday"
          >
            Today
          </button>
        </div>
      </header>

      <!-- Error banner -->
      <div
        v-if="loadError"
        class="mx-3 mt-2 rounded-md border border-rose-500 bg-rose-50 px-3 py-2
               text-[11px] text-rose-700
               dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ loadError }}
      </div>

      <!-- Main layout: calendar + side panel -->
      <div
        class="flex flex-col lg:flex-row border-t border-slate-200
               bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/80"
      >
        <!-- Calendar -->
        <section
          class="flex-1 border-b border-slate-200 lg:border-b-0 lg:border-r
                 bg-white dark:bg-slate-950"
        >
          <div class="overflow-x-auto">
            <div class="w-full sm:min-w-[800px]">
              <!-- Week header -->
              <div
                class="grid grid-cols-7 border-b border-slate-200
                       bg-slate-100 text-[11px] sm:text-xs font-semibold text-slate-700
                       dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <div
                  v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']"
                  :key="w"
                  class="py-2 text-center"
                >
                  {{ w }}
                </div>
              </div>

              <!-- Grid -->
              <div class="grid grid-cols-7 text-[10px] sm:text-xs">
                <button
                  v-for="d in days"
                  :key="d.format('YYYY-MM-DD')"
                  type="button"
                  class="relative min-h-[72px] sm:min-h-[96px]
                         border border-slate-200 bg-white
                         px-1.5 pt-1.5 pb-1 text-left
                         transition-colors duration-150
                         hover:bg-sky-50 hover:border-sky-300
                         dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  :class="{
                    'bg-slate-100 opacity-60 dark:bg-slate-900/80':
                      !d.isSame(currentMonth, 'month'),
                    'border-sky-500 dark:border-sky-500':
                      d.isSame(dayjs(), 'day'),
                    'ring-2 ring-sky-500 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-900':
                      selectedDate === d.format('YYYY-MM-DD')
                  }"
                  @click="selectDay(d)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span
                      class="text-[11px] sm:text-xs font-semibold"
                      :class="{ 'text-red-600 dark:text-red-400': d.day() === 0 }"
                    >
                      {{ d.date() }}
                    </span>
                    <span
                      v-if="d.isSame(dayjs(), 'day')"
                      class="rounded-full bg-sky-600 px-1.5 py-0.5
                             text-[9px] sm:text-[10px] font-semibold text-white"
                    >
                      Today
                    </span>
                  </div>

                  <div class="mt-1 space-y-0.5">
                    <div
                      v-for="(r, i) in byDate[d.format('YYYY-MM-DD')] || []"
                      :key="i"
                      class="flex items-center gap-1 rounded-full border border-slate-900/60
                             px-1 py-0.5 text-[9px] sm:text-[10px] text-white truncate"
                      :style="{ backgroundColor: STATUS_COLOR[r.status] || '#94a3b8' }"
                    >
                      <span class="truncate">
                        {{ r.employee?.name || r.employeeId || '—' }}
                      </span>
                      <span class="text-[9px] opacity-95">
                        ({{ r.passengers ?? 1 }})
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Legend -->
          <div
            class="flex flex-wrap items-center justify-center gap-2
                   border-t border-slate-200 bg-slate-50 px-3 py-2
                   text-[10px] sm:text-xs text-slate-600
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <div
              v-for="(color, status) in STATUS_COLOR"
              :key="status"
              class="flex items-center gap-1.5"
            >
              <span
                class="h-2.5 w-2.5 rounded-full border border-slate-800"
                :style="{ backgroundColor: color }"
              />
              <span>{{ status }}</span>
            </div>
          </div>
        </section>

        <!-- Selected-day panel -->
        <aside
          class="w-full lg:w-80 xl:w-96 bg-slate-50/95
                 border-t border-slate-200 lg:border-t-0 lg:border-l
                 px-3 py-3 text-xs
                 dark:bg-slate-950 dark:border-slate-700"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                {{ selectedDate }}
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ selectedList.length }}
                booking{{ selectedList.length === 1 ? '' : 's' }} on this day
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="rounded-full border border-slate-500 bg-white
                       px-2.5 py-1 text-[11px] font-medium text-slate-800
                       hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100"
                @click="openAdminListForSelected"
              >
                Open list
              </button>
            </div>
          </div>

          <div
            v-if="!selectedList.length"
            class="mt-3 rounded-lg border border-dashed border-slate-500
                   bg-white px-3 py-2 text-[11px] text-slate-600
                   dark:bg-slate-950 dark:text-slate-300"
          >
            No car bookings on this date.
          </div>

          <div v-else class="mt-3 space-y-2">
            <article
              v-for="r in selectedList"
              :key="r._id"
              class="flex flex-col gap-1 rounded-xl border border-slate-600
                     bg-white px-3 py-2 text-[11px]
                     shadow-sm
                     dark:border-slate-600 dark:bg-slate-950"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full border border-slate-700
                           px-2 py-0.5 text-[10px] font-semibold text-slate-900
                           dark:border-slate-400 dark:text-slate-100"
                    :style="{ backgroundColor: (STATUS_COLOR[r.status] || '#e2e8f0') + '33' }"
                  >
                    {{ r.status }}
                  </span>
                  <span
                    class="inline-flex items-center rounded-full border border-slate-400
                           bg-slate-100 px-2 py-0.5 text-[10px] font-medium
                           text-slate-700 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {{ r.category || 'Car' }}
                  </span>
                </div>
                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtTimeRange(r) }}
                </div>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Destination</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ firstDestination(r) }}
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Requester</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.employee?.name || '—' }}
                  <span class="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    ID {{ r?.employee?.employeeId || r.employeeId || '—' }} •
                    {{ r?.employee?.department || '—' }}
                  </span>
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Assignee</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ assigneeLabel(r) }}
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Pax</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r.passengers ?? 1 }}
                </span>
              </div>

              <div class="mt-1 flex justify-end">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click="openRowInAdmin(r)"
                >
                  View in bookings
                </button>
              </div>
            </article>
          </div>
        </aside>
      </div>

      <!-- Loader -->
      <div
        v-if="loading"
        class="border-t border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px]
               text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        Loading…
      </div>
    </div>
  </div>
</template>
