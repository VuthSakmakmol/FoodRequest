<!-- src/views/messenger/MessengerCarCalendar.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter } from 'vue-router'

const router = useRouter()

/* ───────── STATE ───────── */
const currentMonth = ref(dayjs())
const bookings     = ref([])
const loading      = ref(false)
const identity     = ref({ loginId: '', role: '' })

/* ───────── DETECT IDENTITY ───────── */
function detectIdentity () {
  try {
    const u = JSON.parse(localStorage.getItem('auth:user') || '{}')
    const loginId =
      u?.loginId ||
      u?.user?.loginId ||
      localStorage.getItem('loginId') ||
      ''
    const role = (u?.role || u?.user?.role || 'MESSENGER').toUpperCase()
    return { loginId, role }
  } catch {
    return { loginId: '', role: 'MESSENGER' }
  }
}
identity.value = detectIdentity()

/* ───────── DATE COMPUTED ───────── */
const monthLabel   = computed(() => currentMonth.value.format('MMMM YYYY'))
const startOfMonth = computed(() => currentMonth.value.startOf('month'))
const endOfMonth   = computed(() => currentMonth.value.endOf('month'))
const startOfGrid  = computed(() => startOfMonth.value.startOf('week'))
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
async function fetchMonth () {
  const { loginId, role } = identity.value
  if (!loginId) return
  loading.value = true
  bookings.value = []
  try {
    const { data } = await api.get('/messenger/car-bookings', {
      params: { loginId, role },
      headers: { 'x-login-id': loginId, 'x-role': role }
    })
    bookings.value = Array.isArray(data) ? data : []
  } catch (err) {
    console.error('[MessengerCalendar] Error', err)
  } finally {
    loading.value = false
  }
}

/* ───────── GROUP BY DATE ───────── */
const byDate = computed(() => {
  const map = {}
  for (const b of bookings.value) {
    const d = dayjs(b.tripDate).format('YYYY-MM-DD')
    if (!map[d]) map[d] = []
    map[d].push(b)
  }
  return map
})

/* ───────── STATUS COLORS ───────── */
const statusColor = s =>
  ({
    PENDING:   '#94a3b8',
    ACCEPTED:  '#3b82f6',
    ON_ROAD:   '#06b6d4',
    ARRIVING:  '#10b981',
    COMPLETED: '#16a34a',
    DELAYED:   '#facc15',
    CANCELLED: '#ef4444',
    DECLINED:  '#b91c1c'
  }[s] || '#94a3b8')

/* ───────── NAVIGATION ───────── */
function nextMonth () {
  currentMonth.value = currentMonth.value.add(1, 'month')
  fetchMonth()
}
function prevMonth () {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
  fetchMonth()
}
function goToday () {
  currentMonth.value = dayjs()
  fetchMonth()
}

/* ───────── DETAILS ───────── */
function showDayDetails (d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = byDate.value[dateStr]
  if (!list?.length) {
    router.push({ name: 'messenger-assignment', query: { date: dateStr } })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `Messenger Tasks on ${dateStr}`,
    html: `
      <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
        ${list
          .map(
            b => `
          <div
            style="margin-bottom:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;cursor:pointer"
            onclick="window.__selectMessengerBooking('${b._id}', '${dateStr}')"
          >
            <div><b>${b.employee?.name || b.employeeId}</b></div>
            <div>🕓 ${b.timeStart} - ${b.timeEnd}</div>
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
            <div>🚗 ${(b.assignment?.messengerName || 'Unassigned')} • <b>${b.status}</b></div>
          </div>
        `
          )
          .join('')}
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true,
    width: 520,
    didOpen: () => {
      window.__selectMessengerBooking = (id, date) => {
        Swal.close()
        router.push({ name: 'messenger-assignment', query: { focus: id, date } })
      }
    },
    willClose: () => {
      delete window.__selectMessengerBooking
    }
  })
}

/* ───────── INIT ───────── */
onMounted(fetchMonth)
</script>

<template>
  <div class="calendar-wrapper">
    <!-- Toolbar -->
    <div class="calendar-toolbar">
      <button class="btn-nav" @click="prevMonth">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <div class="month-label">{{ monthLabel }}</div>
      <button class="btn-nav" @click="nextMonth">
        <i class="fa-solid fa-chevron-right"></i>
      </button>

      <div class="toolbar-right">
        <button class="btn-flat" @click="fetchMonth">
          <i class="fa-solid fa-rotate-right"></i>
          <span class="ml-1">REFRESH</span>
        </button>
        <button class="btn-flat today" @click="goToday">
          <i class="fa-solid fa-circle-dot"></i>
          <span class="ml-1">TODAY</span>
        </button>
      </div>
    </div>

    <!-- Week header -->
    <div class="week-header">
      <div
        v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']"
        :key="w"
        class="week-cell"
      >
        {{ w }}
      </div>
    </div>

    <!-- Calendar grid -->
    <div class="calendar-grid">
      <div
        v-for="d in days"
        :key="d.format('YYYY-MM-DD')"
        class="day-cell"
        :class="{
          today: d.isSame(dayjs(), 'day'),
          otherMonth: !d.isSame(currentMonth.value, 'month')
        }"
        @click="showDayDetails(d)"
      >
        <div class="day-number" :class="{ sunday: d.day() === 0 }">
          {{ d.date() }}
        </div>

        <div
          v-if="byDate[d.format('YYYY-MM-DD')]"
          class="bookings"
        >
          <div
            v-for="(b, i) in byDate[d.format('YYYY-MM-DD')]"
            :key="i"
            class="booking-chip"
            :style="{ backgroundColor: statusColor(b.status) }"
          >
            {{ b.employee?.name || b.employeeId }} ({{ b.status }})
          </div>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="status-legend">
      <div
        v-for="(color, status) in {
          PENDING:'#94a3b8', ACCEPTED:'#3b82f6', ON_ROAD:'#06b6d4',
          ARRIVING:'#10b981', COMPLETED:'#16a34a', DELAYED:'#facc15',
          CANCELLED:'#ef4444', DECLINED:'#b91c1c'
        }"
        :key="status"
        class="legend-item"
      >
        <span class="legend-dot" :style="{ backgroundColor: color }"></span>
        {{ status }}
      </div>
    </div>

    <div v-if="loading" class="loader">Loading…</div>
  </div>
</template>

<style scoped>
.calendar-wrapper {
  border: 1px solid rgba(100,116,139,.16);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
}

/* Header same style as other transport calendars */
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  border-bottom: 1px solid rgba(15,23,42,.12);
  font-weight: 600;
  color: #fff;
}
.month-label {
  font-size: 13px;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}

/* Nav buttons with visible icons */
.btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: none;
  background: rgba(255,255,255,.2);
  cursor: pointer;
}
.btn-nav:hover {
  background: rgba(255,255,255,.32);
}
.btn-nav i {
  color: #ffffff;
  font-size: 16px;
  line-height: 1;
}

/* Flat buttons */
.btn-flat {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.7);
  background: transparent;
  padding: 2px 5px;
  font-size: .85rem;
  cursor: pointer;
  color: #ffffff;
}
.btn-flat.today {
  background: #4f46e5;
  border-color: #4f46e5;
}
.btn-flat i {
  line-height: 1;
}
.ml-1 { margin-left: .25rem; }

/* Calendar body */
.week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.week-cell {
  text-align: center;
  font-weight: 700;
  padding: 8px 0;
  color: #334155;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.day-cell {
  min-height: 110px;
  border: 1px solid #e2e8f0;
  padding: 6px 8px;
  background: #fff;
  position: relative;
  transition: background .2s;
  cursor: pointer;
}
.day-cell.otherMonth {
  background: #f9fafb;
  opacity: 0.55;
}
.day-cell.today {
  border: 2px solid #2563eb;
}
.day-number {
  font-weight: 700;
  font-size: 0.95rem;
  color: #0f172a;
}
.day-number.sunday {
  color: #dc2626;
}

.bookings {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.booking-chip {
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
  color: #fff;
  font-weight: 600;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

/* Legend */
.status-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin: 10px 0 14px;
  font-size: 0.85rem;
  color: #334155;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.2);
}

/* Loader */
.loader {
  text-align: center;
  padding: 10px;
  color: #475569;
  font-weight: 600;
}
</style>
