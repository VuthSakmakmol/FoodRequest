<!-- views/messenger/MessengerCarCalendar.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter } from 'vue-router'

const router = useRouter()

/* ───────── STATE ───────── */
const currentMonth = ref(dayjs())
const bookings = ref([])
const loading = ref(false)
const identity = ref({ loginId: '', role: '' })

/* ───────── DETECT IDENTITY ───────── */
function detectIdentity() {
  try {
    const u = JSON.parse(localStorage.getItem('auth:user') || '{}')
    const loginId = u?.loginId || u?.user?.loginId || localStorage.getItem('loginId') || ''
    const role = (u?.role || u?.user?.role || 'MESSENGER').toUpperCase()
    return { loginId, role }
  } catch {
    return { loginId: '', role: 'MESSENGER' }
  }
}
identity.value = detectIdentity()

/* ───────── DATE COMPUTED ───────── */
const monthLabel = computed(() => currentMonth.value.format('MMMM YYYY'))
const startOfMonth = computed(() => currentMonth.value.startOf('month'))
const endOfMonth = computed(() => currentMonth.value.endOf('month'))
const startOfGrid = computed(() => startOfMonth.value.startOf('week'))
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

/* ───────── API ───────── */
async function fetchMonth() {
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
    PENDING: '#94a3b8',
    ACCEPTED: '#3b82f6',
    ON_ROAD: '#06b6d4',
    ARRIVING: '#10b981',
    COMPLETED: '#16a34a',
    DELAYED: '#facc15',
    CANCELLED: '#ef4444',
  }[s] || '#94a3b8')

/* ───────── NAVIGATION ───────── */
function nextMonth() { currentMonth.value = currentMonth.value.add(1, 'month'); fetchMonth() }
function prevMonth() { currentMonth.value = currentMonth.value.subtract(1, 'month'); fetchMonth() }
function goToday() { currentMonth.value = dayjs(); fetchMonth() }

/* ───────── DETAILS ───────── */
function showDayDetails(d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = byDate.value[dateStr]
  if (!list?.length) {
    router.push({ name: 'messenger-car-booking', query: { date: dateStr } })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `Messenger Tasks on ${dateStr}`,
    html: `
      <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
        ${list.map(b => `
          <div
            style="margin-bottom:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;cursor:pointer"
            onclick="window.__selectMessengerBooking('${b._id}', '${dateStr}')"
          >
            <div><b>${b.employee?.name || b.employeeId}</b></div>
            <div>🕓 ${b.timeStart} - ${b.timeEnd}</div>
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
            <div>🚗 ${(b.assignment?.messengerName || 'Unassigned')} • <b>${b.status}</b></div>
          </div>
        `).join('')}
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
    willClose: () => { delete window.__selectMessengerBooking }
  })
}

/* ───────── INIT ───────── */
onMounted(fetchMonth)
</script>

<template>
  <div class="calendar-wrapper">
    <div class="calendar-toolbar">
      <button class="btn-nav" @click="prevMonth">‹</button>
      <div class="month-label">{{ monthLabel }}</div>
      <button class="btn-nav" @click="nextMonth">›</button>
      <div class="toolbar-right">
        <button class="btn-flat" @click="fetchMonth">REFRESH</button>
        <button class="btn-flat today" @click="goToday">TODAY</button>
      </div>
    </div>

    <div class="week-header">
      <div v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']" :key="w" class="week-cell">{{ w }}</div>
    </div>

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
        <div class="day-number" :class="{ sunday: d.day() === 0 }">{{ d.date() }}</div>

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
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f5f7fb;
  padding: 10px 16px;
  border-bottom: 1px solid #e2e8f0;
  font-weight: 600;
}
.month-label { font-size: 1.1rem; color: #111827; }
.btn-nav {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 18px;
  width: 38px;
  height: 38px;
  cursor: pointer;
}
.btn-nav:hover { background: #f1f5f9; }
.toolbar-right { display: flex; gap: 8px; }
.btn-flat {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: .9rem;
  cursor: pointer;
}
.btn-flat.today { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.week-cell { text-align: center; font-weight: 700; padding: 8px 0; color: #334155; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.day-cell {
  min-height: 110px;
  border: 1px solid #e2e8f0;
  padding: 6px 8px;
  background: #fff;
  position: relative;
  transition: background .2s;
  cursor: pointer;
}
.day-cell.otherMonth { background: #f9fafb; opacity: 0.5; }
.day-cell.today { border: 2px solid #2563eb; }
.day-number { font-weight: 700; font-size: 0.95rem; color: #0f172a; }
.day-number.sunday { color: #dc2626; }
.bookings { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
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
.loader { text-align: center; padding: 10px; color: #475569; font-weight: 600; }
</style>
