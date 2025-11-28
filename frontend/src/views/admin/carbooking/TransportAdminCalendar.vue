<!-- src/views/admin/transport/TransportAdminCalendar.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'

const router = useRouter()

/* ───────── State ───────── */
const currentMonth = ref(dayjs())
const loading = ref(false)
const bookings = ref([])

/* ───────── Computed ───────── */
const monthLabel = computed(() => currentMonth.value.format('MMMM YYYY'))
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
  loading.value = true
  bookings.value = []
  try {
    const { data } = await api.get('/admin/car-bookings', {
      headers: { 'x-role': 'ADMIN' },
      // you can also pass month if your backend supports it:
      // params: { month: currentMonth.value.format('YYYY-MM') }
    })
    bookings.value = Array.isArray(data) ? data : []
  } catch (err) {
    console.error('[fetchMonth] error', err)
  } finally {
    loading.value = false
  }
}

/* ───────── Grouped by date ───────── */
const byDate = computed(() => {
  const map = {}
  for (const b of bookings.value) {
    const d = dayjs(b.tripDate || b.date).format('YYYY-MM-DD')
    if (!map[d]) map[d] = []
    map[d].push(b)
  }
  return map
})

/* ───────── Status Colors ───────── */
const statusColor = (s) =>
  ({
    PENDING:   '#94a3b8',
    ASSIGNED:  '#64748b',
    ACCEPTED:  '#3b82f6',
    ON_ROAD:   '#06b6d4',
    ARRIVING:  '#10b981',
    COMPLETED: '#16a34a',
    DELAYED:   '#facc15',
    CANCELLED: '#ef4444',
    DECLINED:  '#b91c1c'
  }[s] || '#94a3b8')

/* ───────── Navigation ───────── */
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

/* ───────── Click Handler ───────── */
function showDayDetails (d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = byDate.value[dateStr]

  if (!list?.length) {
    Swal.fire({
      icon: 'info',
      title: `No bookings on ${dateStr}`,
      confirmButtonText: 'OK'
    })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `Bookings on ${dateStr}`,
    html: `
      <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
        ${list
          .map(
            (b) => `
          <div style="
                margin-bottom:6px;
                padding:8px;
                border:1px solid #e2e8f0;
                border-radius:8px;
                background:#f8fafc;
                cursor:pointer
              "
               onclick="window.__selectBooking('${b._id}')">
            <div><b>${b.employee?.name || b.employeeId}</b> (${b.category})</div>
            <div>🕓 ${b.timeStart || '--:--'} - ${b.timeEnd || '--:--'}</div>
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
            <div>🚗 ${(b.assignment?.driverName || 'Unassigned')}</div>
            <div>Status: <b>${b.status}</b></div>
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
      window.__selectBooking = (id) => {
        Swal.close()
        router.push({ name: 'admin-car-booking', query: { focus: id, date: dateStr } })
      }
    },
    willClose: () => {
      delete window.__selectBooking
    }
  })
}

/* ───────── Lifecycle ───────── */
onMounted(fetchMonth)
</script>

<template>
  <div class="calendar-wrapper">
    <!-- Header / toolbar -->
    <div class="calendar-hero">

      <div class="hero-controls">
        <button class="circle-btn" @click="prevMonth">
          <v-icon icon="mdi-chevron-left" size="20" />
        </button>
        <div class="month-label">{{ monthLabel }}</div>
        <button class="circle-btn" @click="nextMonth">
          <v-icon icon="mdi-chevron-right" size="20" />
        </button>

        <div class="hero-right">
          <button class="pill-btn pill-muted" @click="fetchMonth">REFRESH</button>
          <button class="pill-btn pill-primary" @click="goToday">TODAY</button>
        </div>
      </div>
    </div>

    <!-- Scrollable calendar area -->
    <div class="calendar-scroll">
      <div class="calendar-inner">
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

            <div v-if="byDate[d.format('YYYY-MM-DD')]" class="bookings">
              <div
                v-for="(b,i) in byDate[d.format('YYYY-MM-DD')]"
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

    <!-- Legend -->
    <div class="status-legend">
      <div
        v-for="(color, status) in {
          PENDING:'#94a3b8', ASSIGNED:'#64748b', ACCEPTED:'#3b82f6',
          ON_ROAD:'#06b6d4', ARRIVING:'#10b981', COMPLETED:'#16a34a',
          DELAYED:'#facc15', CANCELLED:'#ef4444', DECLINED:'#b91c1c'
        }"
        :key="status"
        class="legend-item"
      >
        <span class="legend-dot" :style="{ backgroundColor: color }"></span>{{ status }}
      </div>
    </div>

    <div v-if="loading" class="loader">Loading…</div>
  </div>
</template>

<style scoped>
.calendar-wrapper {
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 14px;
  background: #ffffff;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
}

/* ── Gradient header (same family as other transport pages) ── */
.calendar-hero {
  padding: 12px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hero-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hero-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 1rem;
}
.hero-sub {
  font-size: 0.85rem;
  opacity: 0.95;
}
.hero-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 4px;
}
.hero-right {
  display: flex;
  gap: 8px;
}

/* buttons */
.circle-btn {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.96);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.18);
}
.circle-btn .v-icon {
  color: #0f172a;
}

.month-label {
  font-weight: 700;
  font-size: 1.02rem;
}

.pill-btn {
  border-radius: 999px;
  padding: 6px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
}
.pill-muted {
  background: rgba(255, 255, 255, 0.92);
  color: #1f2937;
}
.pill-primary {
  background: #4f46e5;
  color: #fff;
}

/* ── Scrollable calendar area ── */
.calendar-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 10px 4px;
}
.calendar-inner {
  min-width: 720px; /* makes it scroll horizontally on narrow devices */
}

/* week header + grid */
.week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-bottom: none;
  border-radius: 10px 10px 0 0;
}
.week-cell {
  text-align: center;
  font-weight: 700;
  padding: 6px 0;
  color: #334155;
  font-size: 0.85rem;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border: 1px solid #e2e8f0;
  border-top: none;
  border-radius: 0 0 10px 10px;
}

/* day cells */
.day-cell {
  min-height: 90px;
  border-right: 1px solid #e2e8f0;
  border-top: 1px solid #e2e8f0;
  padding: 4px 6px;
  background: #ffffff;
  position: relative;
  cursor: pointer;
  transition: background 0.18s;
}
.day-cell:nth-child(7n) {
  border-right: none;
}
.day-cell.otherMonth {
  background: #f9fafb;
  opacity: 0.55;
}
.day-cell.today {
  box-shadow: inset 0 0 0 2px #2563eb;
  z-index: 1;
}
.day-cell:hover {
  background: #eff6ff;
}

.day-number {
  font-weight: 700;
  font-size: 0.9rem;
  color: #0f172a;
}
.day-number.sunday {
  color: #dc2626;
}

/* booking chips */
.bookings {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.booking-chip {
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 0.75rem;
  color: #ffffff;
  font-weight: 600;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

/* legend */
.status-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 6px 0 10px;
  font-size: 0.8rem;
  color: #334155;
  padding: 0 10px 6px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-dot {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.3);
}

.loader {
  text-align: center;
  padding: 8px 10px 12px;
  color: #475569;
  font-weight: 600;
}

/* small screens: slightly shorter cells */
@media (max-width: 600px) {
  .day-cell {
    min-height: 78px;
  }
}
</style>
