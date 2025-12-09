<!-- src/views/driver/DriverCarCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { showToast } = useToast()

/* ───────── State ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const loading      = ref(false)
const loadError    = ref('')
const bookings     = ref([])

const identity = ref({ loginId: '', role: '' })
let leavePreviousRooms = null

/* ───────── Identity detection (same logic as DriverCarBooking) ───────── */
function readCookie(name) {
  const m = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
  )
  return m ? decodeURIComponent(m[1]) : ''
}

function detectIdentity() {
  const found = []
  const tryParse = src => {
    try {
      const u = JSON.parse(localStorage.getItem(src) || sessionStorage.getItem(src) || '{}')
      if (u?.loginId || u?.user?.loginId)
        found.push({
          loginId: String(u.loginId || u?.user?.loginId),
          role: String(u.role || u?.user?.role || '').toUpperCase(),
        })
    } catch {}
  }

  tryParse('auth:user')
  const lsLogin = localStorage.getItem('loginId')
  const lsRole  = (localStorage.getItem('role') || '').toUpperCase()
  if (lsLogin || lsRole) found.push({ loginId: String(lsLogin || ''), role: lsRole })

  const ssLogin = sessionStorage.getItem('loginId')
  const ssRole  = (sessionStorage.getItem('role') || '').toUpperCase()
  if (ssLogin || ssRole) found.push({ loginId: String(ssLogin || ''), role: ssRole })

  const ckLogin = readCookie('loginId')
  const ckRole  = (readCookie('role') || '').toUpperCase()
  if (ckLogin || ckRole) found.push({ loginId: String(ckLogin || ''), role: ckRole })

  for (let i = 0; i < localStorage.length; i++) {
    try {
      const v = JSON.parse(localStorage.getItem(localStorage.key(i)) || 'null')
      const candLogin = v?.loginId || v?.user?.loginId || v?.me?.loginId
      const candRole  = (v?.role || v?.user?.role || v?.me?.role || '').toUpperCase()
      if (candLogin && candRole) {
        found.push({ loginId: String(candLogin), role: candRole })
        break
      }
    } catch {}
  }
  return found.find(x => x.loginId) || { loginId: '', role: 'DRIVER' }
}
identity.value = detectIdentity()

/* ───────── Status colors / labels ───────── */
const STATUS_COLOR = {
  PENDING  : '#94a3b8',
  ASSIGNED : '#64748b',
  ACCEPTED : '#3b82f6',
  ON_ROAD  : '#06b6d4',
  ARRIVING : '#10b981',
  COMPLETED: '#16a34a',
  DELAYED  : '#facc15',
  CANCELLED: '#ef4444',
  DECLINED : '#b91c1c',
}

const STATUS_LABEL_EN = {
  PENDING  : 'Pending',
  ASSIGNED : 'Assigned',
  ACCEPTED : 'Accepted',
  ON_ROAD  : 'On road',
  ARRIVING : 'Arriving',
  COMPLETED: 'Completed',
  DELAYED  : 'Delayed',
  CANCELLED: 'Cancelled',
  DECLINED : 'Declined',
}
const statusLabel = s => STATUS_LABEL_EN[String(s || '').toUpperCase()] || s

/* category label */
const CATEGORY_LABEL = {
  Car: 'Car',
  Motor: 'Motorbike',
}
const categoryLabel = c => CATEGORY_LABEL[c] || c || 'Car'

/* destination text */
function destText(s = {}) {
  return s.destination === 'Other'
    ? s.destinationOther || 'Other'
    : s.destination
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map((s, i) => `#${i + 1}: ${destText(s)}`)
    .join(' • ')
}

/* ───────── Helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const normalize = o => ({
  _id:        String(o?._id || ''),
  status:     o?.status || 'PENDING',
  category:   o?.category || 'Car',
  passengers: o?.passengers ?? 1,
  tripDate:   o?.tripDate || o?.date || null,
  timeStart:  o?.timeStart || '',
  timeEnd:    o?.timeEnd || '',
  stops:      Array.isArray(o?.stops) ? o.stops : [],
  employee:   o?.employee || {},
  employeeId: o?.employeeId || '',
  purpose:    o?.purpose || '',
  assignment: o?.assignment || {},
})

const fmtTimeRange = r =>
  (r.timeStart || r.timeEnd)
    ? [r.timeStart || '', r.timeEnd || ''].filter(Boolean).join(' – ')
    : '—'

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
  for (const r of bookings.value) {
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

const selectedList = computed(() => listForDate(selectedDate.value))

/* ───────── API ───────── */
async function loadMonth() {
  const { loginId, role } = identity.value || { loginId: '', role: '' }
  if (!loginId) return

  loading.value   = true
  loadError.value = ''
  bookings.value  = []

  try {
    const isMessenger = role === 'MESSENGER'
    const basePath = isMessenger ? '/messenger/car-bookings' : '/driver/car-bookings'

    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    const { data } = await api.get(basePath, {
      params: {
        loginId,
        role,
        from,
        to,
      },
      headers: {
        'x-login-id': loginId,
        'x-role'    : role,
      },
    })

    const arr = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    bookings.value = (arr || []).map(normalize)

    // subscribe to rooms for realtime updates
    const ids = bookings.value.map(b => String(b._id)).filter(Boolean)
    if (typeof leavePreviousRooms === 'function') {
      await leavePreviousRooms()
      leavePreviousRooms = null
    }
    leavePreviousRooms = await subscribeBookingRooms(ids)
  } catch (e) {
    console.error('[DriverCarCalendar] loadMonth error:', e)
    loadError.value =
      e?.response?.data?.message || e?.message || 'Failed to load car bookings.'
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

/* View in list page (DriverCarBooking) */
function openListForSelected() {
  router.push({
    name: 'driver-car-booking',
    query: { date: selectedDate.value },
  })
}
function openRowInList(r) {
  router.push({
    name: 'driver-car-booking',
    query: { date: selectedDate.value, focus: r._id },
  })
}

/* ───────── Socket sync (basic) ───────── */
function upsert(doc) {
  const d = normalize(doc)
  const myLogin = (identity.value?.loginId || '').toLowerCase()
  const driverId    = String(doc?.assignment?.driverId || doc?.driverId || '').toLowerCase()
  const messengerId = String(doc?.assignment?.messengerId || doc?.messengerId || '').toLowerCase()
  const mine = myLogin && (driverId === myLogin || messengerId === myLogin)
  if (!mine) return

  const idx = bookings.value.findIndex(x => x._id === d._id)
  if (idx === -1) bookings.value.push(d)
  else bookings.value[idx] = d
}
function onStatus(p) {
  const it = bookings.value.find(x => String(x._id) === String(p?.bookingId))
  if (it && p?.status) it.status = p.status
}
function onDeleted({ _id }) {
  const idx = bookings.value.findIndex(x => x._id === String(_id || ''))
  if (idx !== -1) bookings.value.splice(idx, 1)
}

/* ───────── Lifecycle ───────── */
onMounted(async () => {
  subscribeRoleIfNeeded(identity.value)
  await loadMonth()

  socket.on('carBooking:created', upsert)
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', upsert)
  socket.on('carBooking:deleted', onDeleted)
})

onBeforeUnmount(() => {
  socket.off('carBooking:created', upsert)
  socket.off('carBooking:status', onStatus)
  socket.off('carBooking:assigned', upsert)
  socket.off('carBooking:deleted', onDeleted)
  if (typeof leavePreviousRooms === 'function') leavePreviousRooms()
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Toolbar (follow EmployeeFoodCalendar style) -->
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
              Tap a day to see your trips
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
                      v-for="(r, i) in byDate[d.format('YYYY-MM-DD')] || []"
                      :key="i"
                      class="flex items-center gap-1 rounded-full border border-slate-900/60
                             px-1 py-0.5 text-[9px] sm:text-[10px] text-white truncate"
                      :style="{ backgroundColor: STATUS_COLOR[r.status] || '#94a3b8' }"
                    >
                      <span class="truncate">
                        {{ categoryLabel(r.category) }}
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
              <span>{{ statusLabel(status) }}</span>
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
                trip{{ selectedList.length === 1 ? '' : 's' }} on this day
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="rounded-full border border-slate-500 bg-white
                       px-2.5 py-1 text-[11px] font-medium text-slate-800
                       hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100"
                @click="openListForSelected"
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
            No trip assigned on this date yet.
            Open the list page to see all of your bookings.
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
                <div class="flex flex-col gap-0.5">
                  <span
                    class="inline-flex items-center rounded-full border border-slate-700
                           px-2 py-0.5 text-[10px] font-semibold text-slate-900
                           dark:border-slate-400 dark:text-slate-100"
                    :style="{ backgroundColor: (STATUS_COLOR[r.status] || '#e2e8f0') + '33' }"
                  >
                    {{ statusLabel(r.status) }}
                  </span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ categoryLabel(r.category) }} • {{ r.passengers ?? 1 }} pax
                  </span>
                </div>
                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtTimeRange(r) }}
                </div>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Route</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ prettyStops(r.stops) }}
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Requester</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.employee?.name || '—' }}
                  <span class="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    ID {{ r.employeeId || r?.employee?.employeeId || '—' }} •
                    {{ r?.employee?.department || '—' }}
                  </span>
                </span>
              </div>

              <div v-if="r.purpose" class="flex gap-2">
                <span class="min-w-[64px] text-slate-500">Purpose</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r.purpose }}
                </span>
              </div>

              <div class="mt-1 flex justify-end">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click="openRowInList(r)"
                >
                  View in list
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
