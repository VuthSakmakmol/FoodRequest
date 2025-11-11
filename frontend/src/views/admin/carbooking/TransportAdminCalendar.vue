<!-- src/views/admin/carbooking/TransportAdminCalendar.vue -->
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
  loading.value = true
  bookings.value = []
  try {
    const { data } = await api.get('/admin/car-bookings', {
      params: { month: currentMonth.value.format('YYYY-MM') }
    })
    bookings.value = Array.isArray(data) ? data : []
  } catch (err) {
    console.error(err)
    bookings.value = []
  } finally {
    loading.value = false
  }
}

/* ───────── Grouped ───────── */
const byDate = computed(() => {
  const map = {}
  for (const b of bookings.value) {
    const d = dayjs(b.tripDate || b.date).format('YYYY-MM-DD')
    if (!map[d]) map[d] = []
    map[d].push(b)
  }
  return map
})

/* ───────── Navigation ───────── */
function nextMonth(){ currentMonth.value = currentMonth.value.add(1,'month'); fetchMonth() }
function prevMonth(){ currentMonth.value = currentMonth.value.subtract(1,'month'); fetchMonth() }
function goToday(){ currentMonth.value = dayjs(); fetchMonth() }

/* ───────── Click Handler ───────── */
function showDayDetails(d) {
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
        ${list.map(b => `
          <div style="margin-bottom:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;cursor:pointer"
               onclick="window.__selectBooking('${b._id}')">
            <div><b>${b.employee?.name || b.employeeId}</b> (${b.category})</div>
            <div>🕓 ${b.timeStart || '--:--'} - ${b.timeEnd || '--:--'}</div>
            <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
            <div>🚗 ${b.assignment?.driverName || 'Unassigned'}</div>
          </div>
        `).join('')}
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
    willClose: () => { delete window.__selectBooking }
  })
}

/* ───────── Lifecycle ───────── */
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
        <div class="day-number" :class="{ sunday: d.day() === 0 }">
          {{ d.date() }}
        </div>

        <div v-if="byDate[d.format('YYYY-MM-DD')]" class="bookings">
          <div v-for="(b,i) in byDate[d.format('YYYY-MM-DD')]" :key="i" class="booking-chip">
            {{ b.employee?.name || b.employeeId }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loader">Loading…</div>
  </div>
</template>

<style scoped>
/* ───────── copied base styles from employee calendar ───────── */
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
.btn-flat.today {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}

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
.day-cell.otherMonth { background: #f9fafb; opacity: 0.5; }
.day-cell.today { border: 2px solid #2563eb; }

.day-number {
  font-weight: 700;
  font-size: 0.95rem;
  color: #0f172a;
}
.day-number.sunday { color: #dc2626; }

.bookings { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.booking-chip {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 0.8rem;
  color: #064e3b;
  font-weight: 600;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.loader {
  text-align: center;
  padding: 10px;
  color: #475569;
  font-weight: 600;
}
</style>
