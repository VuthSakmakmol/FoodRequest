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

/* ───────── STATUS COLORS / LABELS (KH) ───────── */
const STATUS_COLORS = {
  PENDING   : '#94a3b8',
  ACCEPTED  : '#3b82f6',
  ON_ROAD   : '#06b6d4',
  ARRIVING  : '#10b981',
  COMPLETED : '#16a34a',
  DELAYED   : '#facc15',
  CANCELLED : '#ef4444',
  DECLINED  : '#b91c1c'
}

const STATUS_LABEL_KM = {
  PENDING   : 'កំពុងរង់ចាំ',
  ACCEPTED  : 'បានព្រមទទួល',
  ON_ROAD   : 'កំពុងធ្វើដំណើរ',
  ARRIVING  : 'ជិតដល់គោលដៅ',
  COMPLETED : 'បានបញ្ចប់',
  DELAYED   : 'យឺតយ៉ាវ',
  CANCELLED : 'បានបោះបង់',
  DECLINED  : 'បដិសេធ'
}

const statusColor = s => STATUS_COLORS[s] || '#94a3b8'
const statusLabel = s => STATUS_LABEL_KM[String(s || '').toUpperCase()] || s

/* ───────── WEEKDAY LABELS (KH) ───────── */
const WEEKDAYS = [
  { key: 'sun', label: 'អាទិត្យ' },
  { key: 'mon', label: 'ចន្ទ' },
  { key: 'tue', label: 'អង្គារ' },
  { key: 'wed', label: 'ពុធ' },
  { key: 'thu', label: 'ព្រហស្បតិ៍' },
  { key: 'fri', label: 'សុក្រ' },
  { key: 'sat', label: 'សៅរ៍' }
]

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

/* ───────── DETAILS (SWEETALERT IN KHMER) ───────── */
function showDayDetails (d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = byDate.value[dateStr]
  if (!list?.length) {
    // 👉 go to messenger list for that date
    router.push({ name: 'messenger-car-booking', query: { date: dateStr } })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `ការងារម៉េសេនជឺរ ថ្ងៃទី ${dateStr}`,
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
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'មិនមាន'}</div>
            <div>🛵 ${(b.assignment?.messengerName || 'មិនទាន់ចាត់ចែង')} • <b>${statusLabel(b.status)}</b></div>
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
        router.push({ name: 'messenger-car-booking', query: { focus: id, date } })
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
      <div class="toolbar-left">
        <button class="btn-nav" @click="prevMonth">
          <v-icon size="18">mdi-chevron-left</v-icon>
        </button>
        <div class="month-label">{{ monthLabel }}</div>
        <button class="btn-nav" @click="nextMonth">
          <v-icon size="18">mdi-chevron-right</v-icon>
        </button>
      </div>

      <div class="toolbar-right">
        <button class="btn-flat" @click="fetchMonth">
          <v-icon size="16" class="mr-1">mdi-rotate-right</v-icon>
          <span>ផ្ទុកឡើងវិញ</span>
        </button>
        <button class="btn-flat today" @click="goToday">
          <v-icon size="16" class="mr-1">mdi-calendar-today</v-icon>
          <span>ថ្ងៃនេះ</span>
        </button>
      </div>
    </div>

    <!-- Scrollable body (vertical + horizontal) -->
    <div class="calendar-body">
      <div class="calendar-inner">
        <!-- Week header -->
        <div class="week-header">
          <div
            v-for="w in WEEKDAYS"
            :key="w.key"
            class="week-cell"
          >
            {{ w.label }}
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
                v-for="(b, i) in byDate[d.format('YYYY-MM-DD')]"
                :key="i"
                class="booking-chip"
                :style="{ backgroundColor: statusColor(b.status) }"
              >
                {{ b.employee?.name || b.employeeId }} ({{ statusLabel(b.status) }})
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="status-legend">
      <div
        v-for="(color, status) in STATUS_COLORS"
        :key="status"
        class="legend-item"
      >
        <span class="legend-dot" :style="{ backgroundColor: color }"></span>
        <span>{{ STATUS_LABEL_KM[status] || status }}</span>
      </div>
    </div>

    <div v-if="loading" class="loader">កំពុងផ្ទុក...</div>
  </div>
</template>

<style scoped>
.calendar-wrapper {
  border: 1px solid rgba(100,116,139,.16);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
  display: flex;
  flex-direction: column;
}

/* Header – blue/purple like other transport calendars */
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  border-bottom: 1px solid rgba(15,23,42,.12);
  font-weight: 600;
  color: #fff;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-right {
  display: flex;
  gap: 6px;
}
.month-label {
  font-size: 0.95rem;
  line-height: 1.2;
  color: #fff;
}

/* Nav buttons (mdi icons inside) */
.btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: none;
  background: rgba(255,255,255,.22);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,.15);
}
.btn-nav:hover {
  background: rgba(255,255,255,.32);
}

/* Flat buttons */
.btn-flat {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.7);
  background: transparent;
  padding: 2px 8px;
  font-size: 0.78rem;
  cursor: pointer;
  color: #ffffff;
}
.btn-flat.today {
  background: #4f46e5;
  border-color: #4f46e5;
}
.mr-1 { margin-right: .25rem; }

/* Scrollable body – both directions */
.calendar-body {
  max-height: 460px;
  overflow-y: auto;
  overflow-x: auto;
}
.calendar-inner {
  min-width: 860px;
}

/* Week header */
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

/* Grid */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.day-cell {
  min-height: 100px;
  border: 1px solid #e2e8f0;
  padding: 5px 6px;
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
  font-size: 0.9rem;
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
  padding: 1px 4px;
  font-size: 0.75rem;
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
  gap: 8px;
  margin: 8px 0 10px;
  font-size: 0.78rem;
  color: #334155;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.2);
}

/* Loader */
.loader {
  text-align: center;
  padding: 8px;
  color: #475569;
  font-weight: 600;
  font-size: 0.8rem;
}

/* 📱 Mobile tweaks */
@media (max-width: 600px) {
  .calendar-wrapper {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .calendar-toolbar {
    padding: 6px 10px;
    flex-wrap: wrap;
    row-gap: 4px;
  }

  .toolbar-left {
    width: 100%;
    justify-content: flex-start;
  }

  .toolbar-right {
    width: 100%;
    justify-content: flex-end;
  }

  .month-label {
    font-size: 0.9rem;
  }

  .btn-nav {
    width: 30px;
    height: 30px;
  }

  .btn-flat {
    padding: 2px 6px;
    font-size: 0.72rem;
  }

  .calendar-body {
    max-height: 380px;
  }

  .day-cell {
    min-height: 80px;
    padding: 4px 4px;
  }

  .booking-chip {
    font-size: 0.7rem;
  }

  .status-legend {
    justify-content: flex-start;
    padding: 0 8px 8px;
    margin-top: 4px;
    font-size: 0.74rem;
    overflow-x: auto;
  }
}
</style>
