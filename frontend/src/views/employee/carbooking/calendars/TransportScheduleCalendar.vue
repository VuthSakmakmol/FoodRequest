<!-- src/views/employee/carBooking/calendars/TransportScheduleCalendar.vue -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'

/* ───────── Router ───────── */
const router = useRouter()

/* ───────── Props ───────── */
const props = defineProps({
  modelValue: { type: String, default: () => dayjs().format('YYYY-MM-DD') },
  maxCar:     { type: Number, default: 3 },
  maxMsgr:    { type: Number, default: 1 }
})
const emit = defineEmits(['update:modelValue'])

/* ───────── State ───────── */
const currentMonth = ref(dayjs(props.modelValue))
const selectedDate = ref(props.modelValue)
const loading = ref(false)
const bookings = ref([])

/* keep in sync if parent changes v-model */
watch(
  () => props.modelValue,
  (val) => {
    if (!val) return
    selectedDate.value = val
    currentMonth.value = dayjs(val)
    fetchMonth()
  }
)

/* ───────── Computed ───────── */
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
    const { data } = await api.get('/public/transport/schedule', {
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

/* ───────── Grouped by Date ───────── */
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

/* ───────── Navigation ───────── */
function nextMonth() {
  currentMonth.value = currentMonth.value.add(1, 'month')
  fetchMonth()
}
function prevMonth() {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
  fetchMonth()
}
function goToday() {
  const today = dayjs()
  currentMonth.value = today
  const iso = today.format('YYYY-MM-DD')
  selectedDate.value = iso
  emit('update:modelValue', iso)
  fetchMonth()
}

/* ───────── Click Handler ───────── */
function selectDay(d) {
  const dateStr = d.format('YYYY-MM-DD')
  const bookingsForDay = byDate.value[dateStr]

  selectedDate.value = dateStr
  emit('update:modelValue', dateStr)

  if (bookingsForDay && bookingsForDay.length > 0) {
    Swal.fire({
      icon: 'info',
      title: `Bookings on ${dateStr}`,
      html: `
        <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
          ${bookingsForDay.map(b => `
            <div
              class="swal-booking"
              data-id="${b._id}"
              style="
                margin-bottom:6px;
                padding:8px;
                border:1px solid #e2e8f0;
                border-radius:8px;
                background:#f8fafc;
                cursor:pointer;
                transition:background .2s;
              "
              onmouseover="this.style.background='#e0f2fe'"
              onmouseout="this.style.background='#f8fafc'"
            >
              <div><b>${b.employee?.name || b.employeeId || 'Unknown'}</b> (${b.category})</div>
              <div>🕓 ${b.timeStart || '--:--'} - ${b.timeEnd || '--:--'}</div>
              <div>📍 ${(b.stops && b.stops[0]?.destination) || 'N/A'}</div>
              <div>🚗 ${b.status}</div>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:10px;">
          <button id="createNewBtn" class="swal2-confirm swal2-styled" style="background:#4f46e5">
            ➕ Create New
          </button>
        </div>
      `,
      showConfirmButton: false,
      width: 480,
      didOpen: () => {
        document.querySelectorAll('.swal-booking').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id')
            Swal.close()
            router.push({
              name: 'employee-car-history',
              query: { focus: id, date: dateStr }
            })
          })
        })
        const btn = document.getElementById('createNewBtn')
        if (btn) {
          btn.addEventListener('click', () => {
            Swal.close()
            router.push({
              name: 'employee-car-booking',
              query: { tripDate: dateStr }
            })
          })
        }
      }
    })
  } else {
    Swal.fire({
      icon: 'question',
      title: 'No bookings yet',
      text: `Do you want to create a booking for ${dateStr}?`,
      showCancelButton: true,
      confirmButtonText: 'Yes, create booking',
      cancelButtonText: 'No'
    }).then(res => {
      if (res.isConfirmed) {
        router.push({
          name: 'employee-car-booking',
          query: { tripDate: dateStr }
        })
      }
    })
  }
}

/* ───────── Lifecycle ───────── */
onMounted(fetchMonth)
</script>

<template>
  <div class="calendar-wrapper">
    <!-- Toolbar -->
    <div class="calendar-toolbar">
      <div class="toolbar-left">
        <button class="btn-nav" @click="prevMonth">‹</button>
        <div class="month-label">{{ monthLabel }}</div>
        <button class="btn-nav" @click="nextMonth">›</button>
      </div>

      <div class="toolbar-right">
        <button class="btn-flat" @click="fetchMonth">REFRESH</button>
        <button class="btn-flat today" @click="goToday">TODAY</button>
      </div>
    </div>

    <!-- Scrollable body (vertical + horizontal) -->
    <div class="calendar-body">
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
              otherMonth: !d.isSame(currentMonth, 'month'),
              selected: selectedDate === d.format('YYYY-MM-DD')
            }"
            @click="selectDay(d)"
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
                {{ b.category }} ({{ b.status }})
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
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
  display: flex;
  flex-direction: column;
}

/* Toolbar — match other transport headers */
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-weight: 600;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color: #fff;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.month-label {
  font-size: 1.1rem;
  color: #fff;
}

.btn-nav {
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.3);
  border-radius: 8px;
  font-size: 18px;
  width: 38px;
  height: 38px;
  cursor: pointer;
  color: #fff;
}
.btn-nav:hover {
  background: rgba(255,255,255,.3);
}

.toolbar-right {
  display: flex;
  gap: 8px;
}
.btn-flat {
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: .9rem;
  cursor: pointer;
  color: #fff;
}
.btn-flat.today {
  background: #4f46e5;
  border-color: #c7d2fe;
}

/* Scrollable body – both directions */
.calendar-body {
  max-height: 460px;         /* vertical scroll */
  overflow-y: auto;
  overflow-x: auto;          /* horizontal scroll */
  -webkit-overflow-scrolling: touch;
}

/* Inner container is wider than phone */
.calendar-inner {
  min-width: 860px;          /* force horizontal scroll on small screens */
}

/* Week row */
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

/* Grid */
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
  opacity: 0.5;
}
.day-cell.today {
  border: 2px solid #2563eb;
}
.day-cell.selected {
  box-shadow: inset 0 0 0 2px #4f46e5;
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

/* SweetAlert inline booking hover */
:deep(.swal-booking:hover) {
  background-color: #e0f2fe !important;
}

/* 📱 Mobile tweaks */
@media (max-width: 600px) {
  .calendar-wrapper {
    border: none;
    border-radius: 0;
  }

  .calendar-toolbar {
    padding: 8px 10px;
    flex-wrap: wrap;
    gap: 6px;
  }

  .toolbar-left {
    width: 100%;
    justify-content: space-between;
  }

  .toolbar-right {
    width: 100%;
    justify-content: flex-end;
  }

  .month-label {
    font-size: 1rem;
  }

  .btn-nav {
    width: 32px;
    height: 32px;
    font-size: 16px;
  }

  .btn-flat {
    padding: 4px 8px;
    font-size: 0.8rem;
  }

  .calendar-body {
    max-height: 380px;
  }

  .day-cell {
    min-height: 80px;
    padding: 4px 4px;
  }

  .booking-chip {
    font-size: 0.72rem;
    padding: 1px 3px;
  }

  .status-legend {
    justify-content: flex-start;
    padding: 0 8px 8px;
    margin-top: 6px;
    font-size: 0.8rem;
    overflow-x: auto;
  }
}
</style>
