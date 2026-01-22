<!-- src/views/employee/foodBooking/EmployeeFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { showToast } = useToast()

/* ✅ keep only wanted statuses on calendar */
const CALENDAR_STATUSES = ['NEW', 'ACCEPTED', 'CANCELED']
const isAllowedCalendarStatus = (s) => CALENDAR_STATUSES.includes(String(s || '').toUpperCase())

/* ───────── State ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const loading = ref(false)
const loadError = ref('')
const requests = ref([])

const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* ───────── Status colors (ONLY wanted) ───────── */
const STATUS_COLOR = {
  NEW: '#94a3b8',
  ACCEPTED: '#6366f1',
  CANCELED: '#ef4444',
}

/* ───────── Helpers ───────── */
const fmtDate = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const normalize = (o) => ({
  _id: String(o?._id || ''),
  status: String(o?.status || 'NEW').toUpperCase(),
  orderType: o?.orderType || 'Daily meal',
  quantity: Number(o?.quantity || 0),
  eatDate: o?.eatDate || o?.serveDate || null,
  eatTimeStart: o?.eatTimeStart || '',
  eatTimeEnd: o?.eatTimeEnd || '',
  meals: Array.isArray(o?.meals) ? o.meals : [],
  employee: o?.employee || {},
  location: o?.location || {},
})

const fmtTimeRange = (r) =>
  (r.eatTimeStart || r.eatTimeEnd)
    ? [r.eatTimeStart || '', r.eatTimeEnd || ''].filter(Boolean).join(' – ')
    : '—'

const fmtMeals = (r) =>
  Array.isArray(r.meals) && r.meals.length ? r.meals.join(', ') : '—'

/* ───────── Month grid ───────── */
const monthLabel = computed(() => currentMonth.value.format('MMMM YYYY'))
const startOfMonth = computed(() => currentMonth.value.startOf('month'))
const endOfMonth = computed(() => currentMonth.value.endOf('month'))
const startOfGrid = computed(() => startOfMonth.value.startOf('week')) // Sunday
const endOfGrid = computed(() => endOfMonth.value.endOf('week'))

const days = computed(() => {
  const arr = []
  let d = startOfGrid.value
  while (d.isBefore(endOfGrid.value) || d.isSame(endOfGrid.value, 'day')) {
    arr.push(d)
    d = d.add(1, 'day')
  }
  return arr
})

/* ───────── Group by date (calendar only) ───────── */
const byDate = computed(() => {
  const map = {}
  for (const r of requests.value) {
    if (!isAllowedCalendarStatus(r.status)) continue
    const key = fmtDate(r.eatDate)
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

function listForDate(dateStr) {
  const list = byDate.value[dateStr] || []
  return list.slice().sort((a, b) => {
    const tA = (a.eatTimeStart || '') + (a.eatTimeEnd || '')
    const tB = (b.eatTimeStart || '') + (b.eatTimeEnd || '')
    return (
      tA.localeCompare(tB) ||
      (a.status || '').localeCompare(b.status || '') ||
      (a.employee?.name || '').localeCompare(b.employee?.name || '')
    )
  })
}

/* Panel data for selected date (calendar only) */
const selectedList = computed(() => listForDate(selectedDate.value))

/* ───────── API ───────── */
async function loadMonth() {
  loading.value = true
  loadError.value = ''
  requests.value = []
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to = endOfGrid.value.format('YYYY-MM-DD')

    const { data } = await api.get('/public/food-requests', {
      params: {
        employeeId: employeeId.value || undefined,
        from,
        to,
      },
    })

    const list = Array.isArray(data) ? data : data?.rows || data?.data || []

    // ✅ filter here too (so panel + calendar both clean)
    requests.value = (list || [])
      .map(normalize)
      .filter((r) => isAllowedCalendarStatus(r.status))
  } catch (e) {
    console.error('[EmployeeFoodCalendar] loadMonth error:', e)
    loadError.value =
      e?.response?.data?.message || e?.message || 'Failed to load food calendar.'
    requests.value = []
    showToast({
      type: 'error',
      title: 'Unable to load',
      message: loadError.value,
      timeout: 2500,
    })
  } finally {
    loading.value = false
  }
}

/* ───────── Navigation ───────── */
function nextMonth() {
  currentMonth.value = currentMonth.value.add(1, 'month')
  loadMonth()
}
function prevMonth() {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
  loadMonth()
}
function goToday() {
  currentMonth.value = dayjs()
  selectedDate.value = dayjs().format('YYYY-MM-DD')
  loadMonth()
}

/* ───────── Click handlers ───────── */
function selectDay(d) {
  selectedDate.value = d.format('YYYY-MM-DD')
}

/* open history + create for selected date */
function openHistoryForSelected() {
  router.push({
    name: 'employee-request-history',
    query: { date: selectedDate.value },
  })
}
function createNewForSelected() {
  router.push({
    name: 'employee-request',
    query: { eatDate: selectedDate.value },
  })
}
function openRowInHistory(r) {
  router.push({
    name: 'employee-request-history',
    query: { date: selectedDate.value, focus: r._id },
  })
}

/* ───────── Socket sync ───────── */
function upsert(doc) {
  const d = normalize(doc)
  const empId = doc?.employee?.employeeId || doc?.employeeId
  if (employeeId.value && String(empId) !== String(employeeId.value)) return

  // ✅ ignore unwanted statuses for calendar view
  if (!isAllowedCalendarStatus(d.status)) {
    removeById(d._id)
    return
  }

  const idx = requests.value.findIndex((x) => x._id === d._id)
  if (idx === -1) requests.value.push(d)
  else requests.value[idx] = d
}

function removeById(id) {
  const idx = requests.value.findIndex((x) => x._id === id)
  if (idx !== -1) requests.value.splice(idx, 1)
}
const onDeleted = ({ _id }) => removeById(String(_id || ''))

/* ───────── Lifecycle ───────── */
onMounted(async () => {
  subscribeEmployeeIfNeeded()
  await loadMonth()

  socket.on('foodRequest:created', upsert)
  socket.on('foodRequest:updated', upsert)
  socket.on('foodRequest:statusChanged', upsert)
  socket.on('foodRequest:deleted', onDeleted)
})

onBeforeUnmount(() => {
  socket.off('foodRequest:created', upsert)
  socket.off('foodRequest:updated', upsert)
  socket.off('foodRequest:statusChanged', upsert)
  socket.off('foodRequest:deleted', onDeleted)
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <!-- Toolbar (same header colors as EmployeeFoodBooking) -->
      <header
        class="flex flex-wrap items-center justify-between gap-2
               px-3 py-2
               rounded-t-2xl border-b border-slate-400
               bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
               px-4 py-3 text-white
               dark:border-slate-700"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full
                   border border-slate-900/70 bg-white text-slate-900 text-base
                   shadow-sm hover:bg-slate-100"
            @click="prevMonth"
          >
            ‹
          </button>
          <div class="flex flex-col">
            <span class="text-sm sm:text-base font-semibold">
              {{ monthLabel }}
            </span>
            <span class="text-[11px] text-slate-100/80">
              Tap a day to see your meals (NEW / ACCEPTED / CANCELED)
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-slate-100/70
                   bg-white/10 px-3 py-1.5 text-[11px] font-medium
                   hover:bg-white/15"
            @click="loadMonth"
          >
            Refresh
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-sky-200
                   bg-sky-600 px-3 py-1.5 text-[11px] font-semibold
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
      <div class="flex flex-col lg:flex-row border-t border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/80">
        <!-- Calendar -->
        <section class="flex-1 border-b border-slate-200 lg:border-b-0 lg:border-r bg-white dark:bg-slate-950">
          <div class="overflow-x-auto">
            <div class="w-full sm:min-w-[800px]">
              <!-- Week header -->
              <div
                class="grid grid-cols-7 border-b border-slate-200
                       bg-slate-100 text-[11px] sm:text-xs font-semibold text-slate-700
                       dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <div v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']" :key="w" class="py-2 text-center">
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
                    'bg-slate-100 opacity-60 dark:bg-slate-900/80': !d.isSame(currentMonth, 'month'),
                    'border-sky-500 dark:border-sky-500': d.isSame(dayjs(), 'day'),
                    'ring-2 ring-sky-500 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-900':
                      selectedDate === d.format('YYYY-MM-DD')
                  }"
                  @click="selectDay(d)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-[11px] sm:text-xs font-semibold" :class="{ 'text-red-600 dark:text-red-400': d.day() === 0 }">
                      {{ d.date() }}
                    </span>
                    <span
                      v-if="d.isSame(dayjs(), 'day')"
                      class="rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-white"
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
                        {{ r.orderType || 'Meal' }}
                      </span>
                      <span class="text-[9px] opacity-95">
                        ({{ r.quantity || 0 }})
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Legend (ONLY wanted) -->
          <div
            class="flex flex-wrap items-center justify-center gap-2
                   border-t border-slate-200 bg-slate-50 px-3 py-2
                   text-[10px] sm:text-xs text-slate-600
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <div v-for="(color, status) in STATUS_COLOR" :key="status" class="flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-full border border-slate-800" :style="{ backgroundColor: color }" />
              <span>{{ status }}</span>
            </div>
          </div>
        </section>

        <!-- Selected-day panel -->
        <aside class="w-full lg:w-80 xl:w-96 bg-slate-50/95 border-t border-slate-200 lg:border-t-0 lg:border-l px-3 py-3 text-xs dark:bg-slate-950 dark:border-slate-700">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                {{ selectedDate }}
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ selectedList.length }} request{{ selectedList.length === 1 ? '' : 's' }} on this day
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="rounded-full border border-sky-600 bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
                @click="createNewForSelected"
              >
                ➕ New
              </button>
              <button
                type="button"
                class="rounded-full border border-slate-500 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100"
                @click="openHistoryForSelected"
              >
                History
              </button>
            </div>
          </div>

          <div
            v-if="!selectedList.length"
            class="mt-3 rounded-lg border border-dashed border-slate-500 bg-white px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-950 dark:text-slate-300"
          >
            No meal request on this date yet.
            Click <span class="font-semibold">New</span> to create one.
          </div>

          <div v-else class="mt-3 space-y-2">
            <article
              v-for="r in selectedList"
              :key="r._id"
              class="flex flex-col gap-1 rounded-xl border border-slate-600 bg-white px-3 py-2 text-[11px] shadow-sm dark:border-slate-600 dark:bg-slate-950"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-900 dark:border-slate-400 dark:text-slate-100"
                    :style="{ backgroundColor: (STATUS_COLOR[r.status] || '#e2e8f0') + '33' }"
                  >
                    {{ r.status }}
                  </span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ r.orderType }}
                  </span>
                </div>
                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtTimeRange(r) }}
                </div>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[60px] text-slate-500">Meals</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ fmtMeals(r) }} (Qty {{ r.quantity }})
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[60px] text-slate-500">Location</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.location?.kind || '—' }}
                  <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[60px] text-slate-500">Requester</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.employee?.name || '—' }}
                  <span class="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    ID {{ r?.employee?.employeeId || '—' }} • {{ r?.employee?.department || '—' }}
                  </span>
                </span>
              </div>

              <div class="mt-1 flex justify-end">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click="openRowInHistory(r)"
                >
                  View in history
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
