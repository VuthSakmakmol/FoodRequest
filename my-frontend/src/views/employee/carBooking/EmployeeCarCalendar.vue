<!-- src/views/employee/carbooking/EmployeeCarCalendar.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { showToast } = useToast()

/* ───────── State ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const loading      = ref(false)
const loadError    = ref('')
const bookings     = ref([])

/* we show full schedule (not filtered by employee) */

/* ───────── Status & category colors ───────── */
const STATUS_COLOR = {
  PENDING:   '#94a3b8',
  ACCEPTED:  '#3b82f6',
  ON_ROAD:   '#06b6d4',
  ARRIVING:  '#10b981',
  COMPLETED: '#16a34a',
  DELAYED:   '#facc15',
  CANCELLED: '#ef4444',
  DECLINED:  '#b91c1c'
}
const CATEGORY_ICON = {
  Car: 'fa-solid fa-car',
  Messenger: 'fa-solid fa-motorcycle'
}

/* capacities kept for legend/info */
const MAX_CAR  = 3
const MAX_MSGR = 1

/* ───────── Helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const normalize = (o) => ({
  _id:       String(o?._id || ''),
  status:    o?.status || 'PENDING',
  category:  o?.category || 'Car',
  tripDate:  o?.tripDate || o?.date || null,
  timeStart: o?.timeStart || '',
  timeEnd:   o?.timeEnd || '',
  passengers: Number(o?.passengers ?? 1),
  employee:  o?.employee || {},
  stops:     Array.isArray(o?.stops) ? o.stops : [],
})

const fmtTimeRange = (b) =>
  (b.timeStart || b.timeEnd)
    ? [b.timeStart || '', b.timeEnd || ''].filter(Boolean).join(' – ')
    : '—'

const fmtStops = (b) => {
  const stops = Array.isArray(b.stops) ? b.stops : []
  if (!stops.length) return '—'
  return stops
    .map(s => s.destination === 'Other'
      ? (s.destinationOther || 'Other')
      : (s.destination || '—'))
    .join(' → ')
}

/* ───────── Month grid ───────── */
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

/* ───────── Group by date ───────── */
const byDate = computed(() => {
  const map = {}
  for (const raw of bookings.value) {
    const b = normalize(raw)
    const key = fmtDate(b.tripDate)
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(b)
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

/* Panel data for selected date */
const selectedList = computed(() => listForDate(selectedDate.value))

/* ───────── API ───────── */
async function loadMonth() {
  loading.value = true
  loadError.value = ''
  bookings.value = []
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    const { data } = await api.get('/public/transport/schedule', {
      params: { month: currentMonth.value.format('YYYY-MM') }
    })

    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    bookings.value = (list || []).map(normalize)
  } catch (e) {
    console.error('[EmployeeCarCalendar] loadMonth error:', e)
    loadError.value =
      e?.response?.data?.message || e?.message || 'Failed to load car booking calendar.'
    bookings.value = []
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
  const dateStr = d.format('YYYY-MM-DD')
  selectedDate.value = dateStr
}

/* open history + create for selected date */
function openHistoryForSelected() {
  router.push({
    name: 'employee-car-history',
    query: { date: selectedDate.value }
  })
}
function createNewForSelected() {
  router.push({
    name: 'employee-car-booking',
    query: { tripDate: selectedDate.value }
  })
}
function openRowInHistory(b) {
  router.push({
    name: 'employee-car-history',
    query: { date: selectedDate.value, focus: b._id }
  })
}

/* ───────── Lifecycle ───────── */
onMounted(async () => {
  await loadMonth()
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Toolbar (same style as EmployeeFoodCalendar) -->
      <header
        class="flex flex-wrap items-center justify-between gap-2
               px-3 py-2
               rounded-t-2xl border-b border-slate-400
               bg-gradient-to-r from-sky-900 via-slate-800 to-sky-700
               text-slate-50
               dark:border-slate-700 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900"
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
              Tap a day to see car & messenger bookings
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
                      v-for="(b, i) in byDate[d.format('YYYY-MM-DD')] || []"
                      :key="i"
                      class="flex items-center gap-1 rounded-full border border-slate-900/60
                             px-1 py-0.5 text-[9px] sm:text-[10px] text-white truncate"
                      :style="{ backgroundColor: STATUS_COLOR[b.status] || '#94a3b8' }"
                    >
                      <span class="truncate">
                        {{ b.category }}
                      </span>
                      <span class="text-[9px] opacity-95">
                        ({{ b.timeStart || '--:--' }})
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Legend + capacity -->
          <div
            class="flex flex-wrap items-center justify-between gap-2
                   border-t border-slate-200 bg-slate-50 px-3 py-2
                   text-[10px] sm:text-xs text-slate-600
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <div class="flex flex-wrap items-center gap-2">
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

            <div class="flex flex-wrap gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800"
              >
                <i class="fa-solid fa-car text-[10px]"></i>
                Max car per slot: {{ MAX_CAR }}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800"
              >
                <i class="fa-solid fa-motorcycle text-[10px]"></i>
                Max messenger per slot: {{ MAX_MSGR }}
              </span>
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
                class="rounded-full border border-sky-600 bg-sky-600
                       px-2.5 py-1 text-[11px] font-semibold text-white
                       hover:bg-sky-500"
                @click="createNewForSelected"
              >
                ➕ New
              </button>
              <button
                type="button"
                class="rounded-full border border-slate-500 bg-white
                       px-2.5 py-1 text-[11px] font-medium text-slate-800
                       hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100"
                @click="openHistoryForSelected"
              >
                Day schedule
              </button>
            </div>
          </div>

          <div
            v-if="!selectedList.length"
            class="mt-3 rounded-lg border border-dashed border-slate-500
                   bg-white px-3 py-2 text-[11px] text-slate-600
                   dark:bg-slate-950 dark:text-slate-300"
          >
            No car or messenger booking on this date yet.
            Click <span class="font-semibold">New</span> to create one.
          </div>

          <div v-else class="mt-3 space-y-2">
            <article
              v-for="b in selectedList"
              :key="b._id"
              class="flex flex-col gap-1 rounded-xl border border-slate-600
                     bg-white px-3 py-2 text-[11px]
                     shadow-sm
                     dark:border-slate-600 dark:bg-slate-950"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-slate-700
                           px-2 py-0.5 text-[10px] font-semibold text-slate-900
                           dark:border-slate-400 dark:text-slate-100"
                    :style="{ backgroundColor: (STATUS_COLOR[b.status] || '#e2e8f0') + '33' }"
                  >
                    <i :class="CATEGORY_ICON[b.category] || 'fa-solid fa-car'" class="text-[10px]"></i>
                    <span>{{ b.category }}</span>
                    <span>• {{ b.status }}</span>
                  </span>
                </div>
                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtTimeRange(b) }}
                </div>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Route</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ fmtStops(b) }}
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Passengers</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ b.passengers ?? 1 }}
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Requester</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ b?.employee?.name || '—' }}
                  <span class="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    ID {{ b?.employee?.employeeId || '—' }} •
                    {{ b?.employee?.department || '—' }}
                  </span>
                </span>
              </div>

              <div class="mt-1 flex justify-end">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click="openRowInHistory(b)"
                >
                  View in day schedule
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
