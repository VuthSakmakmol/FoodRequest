<!-- views/driver/DriverCarCalendar.vue -->
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
function detectIdentity() {
  try {
    const u = JSON.parse(
      localStorage.getItem('user') ||
      localStorage.getItem('auth:user') ||
      '{}'
    )
    const loginId =
      u?.id ||
      u?.loginId ||
      u?.user?.loginId ||
      localStorage.getItem('loginId') ||
      ''
    const role =
      u?.role ||
      u?.user?.role ||
      localStorage.getItem('role') ||
      'DRIVER'
    return { loginId, role: String(role).toUpperCase() }
  } catch {
    return { loginId: '', role: 'DRIVER' }
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
async function fetchMonth() {
  const { loginId, role } = identity.value
  if (!loginId) return

  loading.value = true
  bookings.value = []
  try {
    const { data } = await api.get('/driver/car-bookings', {
      params:  { loginId, role },
      headers: { 'x-login-id': loginId, 'x-role': role }
    })
    bookings.value = Array.isArray(data) ? data : []
  } catch (err) {
    console.error('[DriverCalendar] Error', err)
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
    PENDING  : '#94a3b8',
    ACCEPTED : '#3b82f6',
    ON_ROAD  : '#06b6d4',
    ARRIVING : '#10b981',
    COMPLETED: '#16a34a',
    DELAYED  : '#facc15',
    CANCELLED: '#ef4444'
  }[s] || '#94a3b8')

/* ───────── NAVIGATION ───────── */
function nextMonth()  { currentMonth.value = currentMonth.value.add(1, 'month'); fetchMonth() }
function prevMonth()  { currentMonth.value = currentMonth.value.subtract(1, 'month'); fetchMonth() }
function goToday()    { currentMonth.value = dayjs(); fetchMonth() }

/* ───────── DETAILS ───────── */
function showDayDetails(d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = byDate.value[dateStr]
  if (!list?.length) {
    router.push({ name: 'driver-car-booking', query: { date: dateStr } })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `Driver Bookings on ${dateStr}`,
    html: `
      <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
        ${list.map(b => `
          <div
            style="margin-bottom:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;cursor:pointer"
            onclick="window.__selectDriverBooking('${b._id}', '${dateStr}')"
          >
            <div><b>${b.employee?.name || b.employeeId}</b></div>
            <div>🕓 ${b.timeStart} - ${b.timeEnd}</div>
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
            <div>🚗 ${(b.assignment?.driverName || 'Unassigned')} • <b>${b.status}</b></div>
          </div>
        `).join('')}
      </div>
    `,
    showConfirmButton: false,
    showCloseButton : true,
    width: 520,
    didOpen: () => {
      window.__selectDriverBooking = (id, date) => {
        Swal.close()
        router.push({ name: 'driver-car-booking', query: { focus: id, date } })
      }
    },
    willClose: () => { delete window.__selectDriverBooking }
  })
}

/* ───────── INIT ───────── */
onMounted(fetchMonth)
</script>

<template>
  <div class="calendar-page">
    <div class="calendar-wrapper">
      <!-- Toolbar -->
      <div class="calendar-toolbar">
        <button class="btn-nav" @click="prevMonth">‹</button>
        <div class="month-label">{{ monthLabel }}</div>
        <button class="btn-nav" @click="nextMonth">›</button>
        <div class="toolbar-right">
          <button class="btn-flat" @click="fetchMonth">REFRESH</button>
          <button class="btn-flat today" @click="goToday">TODAY</button>
        </div>
      </div>

      <!-- Scrollable week header + grid -->
      <div class="calendar-scroll">
        <div class="calendar-inner">
          <div class="week-header">
            <div
              v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']"
              :key="w"
              class="week-cell"
            >
              {{ w }}
            </div>
          </div>

          <div class="calendar-grid">
            <div
              v-for="d in days"
              :key="d.format('YYYY-MM-DD')"
              class="day-cell"
              :class="{
                today     : d.isSame(dayjs(), 'day'),
                otherMonth: !d.isSame(currentMonth.value, 'month')
              }"
              @click="showDayDetails(d)"
            >
              <div class="day-number" :class="{ sunday: d.day() === 0 }">
                {{ d.date() }}
              </div>

              <div v-if="byDate[d.format('YYYY-MM-DD')]" class="bookings">
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
        </div>
      </div>

      <div v-if="loading" class="loader">Loading…</div>
    </div>

    <!-- Legend (below card) -->
    <div class="status-legend">
      <div
        v-for="(color, status) in {
          PENDING:'#94a3b8',
          ACCEPTED:'#3b82f6',
          ON_ROAD:'#06b6d4',
          ARRIVING:'#10b981',
          COMPLETED:'#16a34a',
          DELAYED:'#facc15',
          CANCELLED:'#ef4444'
        }"
        :key="status"
        class="legend-item"
      >
        <span class="legend-dot" :style="{ backgroundColor: color }"></span>
        <span class="legend-label">{{ status }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* page container: a bit of air on desktop, edge on phone */
.calendar-page {
  padding: 8px 10px 12px;
}
@media (max-width: 600px) {
  .calendar-page {
    padding: 0;
  }
}

/* main card */
.calendar-wrapper {
  border: 1px solid rgba(100,116,139,.16);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
  max-width: 1100px;
  margin: 0 auto;
}
@media (max-width: 600px) {
  .calendar-wrapper {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
}

/* toolbar */
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f5f7fb;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  font-weight: 600;
}
.month-label {
  font-size: 1.05rem;
  color: #111827;
}
.btn-nav {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  font-size: 18px;
  width: 34px;
  height: 34px;
  cursor: pointer;
}
.btn-nav:hover {
  background: #f1f5f9;
}
.toolbar-right {
  display: flex;
  gap: 6px;
}
.btn-flat {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: .8rem;
  cursor: pointer;
}
.btn-flat.today {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}

@media (max-width: 600px) {
  .calendar-toolbar {
    padding: 6px 8px;
  }
  .month-label {
    font-size: .95rem;
  }
  .btn-flat {
    padding: 4px 8px;
    font-size: .75rem;
  }
  .btn-nav {
    width: 30px;
    height: 30px;
  }
}

/* scroll container */
.calendar-scroll {
  overflow-x: auto;
}
.calendar-inner {
  min-width: 900px; /* wider than small screens → can scroll left/right */
}
@media (max-width: 600px) {
  .calendar-inner {
    min-width: 750px; /* still scrollable but a bit tighter on phone */
  }
}

/* week header */
.week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.week-cell {
  text-align: center;
  font-weight: 700;
  padding: 6px 0;
  color: #334155;
  font-size: 0.8rem;
}

/* grid */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.day-cell {
  min-height: 100px;
  border: 1px solid #e2e8f0;
  padding: 4px 6px;
  background: #fff;
  position: relative;
  transition: background .15s;
  cursor: pointer;
}
.day-cell.otherMonth {
  background: #f9fafb;
  opacity: 0.7;
}
.day-cell.today {
  border: 2px solid #2563eb;
}
.day-cell:hover {
  background: #f8fafc;
}

.day-number {
  font-weight: 700;
  font-size: 0.9rem;
  color: #0f172a;
}
.day-number.sunday {
  color: #dc2626;
}

.bookings {
  margin-top: 3px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.booking-chip {
  border-radius: 6px;
  padding: 1px 3px;
  font-size: 0.7rem;
  color: #fff;
  font-weight: 600;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .day-cell {
    min-height: 72px;
    padding: 3px 4px;
  }
  .day-number {
    font-size: 0.8rem;
  }
  .booking-chip {
    font-size: 0.65rem;
  }
}

/* loader */
.loader {
  text-align: center;
  padding: 8px;
  color: #475569;
  font-weight: 600;
}

/* legend */
.status-legend {
  max-width: 1100px;
  margin: 8px auto 10px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #334155;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.2);
}
.legend-label {
  white-space: nowrap;
}

@media (max-width: 600px) {
  .status-legend {
    margin: 6px 4px 10px;
    font-size: 0.75rem;
  }
}
</style>
