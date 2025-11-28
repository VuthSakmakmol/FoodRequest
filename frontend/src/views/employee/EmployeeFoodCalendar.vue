<!-- src/views/employee/EmployeeFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'

const router = useRouter()

/* ───────── State ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const loading      = ref(false)
const requests     = ref([])

const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* ───────── Status colors ───────── */
const STATUS_COLOR = {
  NEW:       '#94a3b8',
  ACCEPTED:  '#6366f1',
  COOKING:   '#f97316',
  READY:     '#0d9488',
  DELIVERED: '#16a34a',
  CANCELED:  '#ef4444'
}

/* ───────── Helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const normalize = (o) => ({
  _id:          String(o?._id || ''),
  status:       o?.status || 'NEW',
  orderType:    o?.orderType || 'Daily meal',
  quantity:     Number(o?.quantity || 0),
  eatDate:      o?.eatDate || o?.serveDate || null,
  eatTimeStart: o?.eatTimeStart || '',
  eatTimeEnd:   o?.eatTimeEnd || '',
  meals:        o?.meals || [],
  employee:     o?.employee || {},
  location:     o?.location || {},
})

const fmtTimeRange = (r) =>
  (r.eatTimeStart || r.eatTimeEnd)
    ? [r.eatTimeStart || '', r.eatTimeEnd || ''].filter(Boolean).join(' – ')
    : '—'

const fmtMeals = (r) =>
  Array.isArray(r.meals) && r.meals.length
    ? r.meals.join(', ')
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
  for (const r of requests.value) {
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
    return tA.localeCompare(tB) ||
      (a.status || '').localeCompare(b.status || '') ||
      (a.employee?.name || '').localeCompare(b.employee?.name || '')
  })
}

/* ───────── API ───────── */
async function loadMonth() {
  loading.value = true
  requests.value = []
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    const { data } = await api.get('/public/food-requests', {
      params: {
        employeeId: employeeId.value || undefined,
        from,
        to
      }
    })

    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    requests.value = (list || []).map(normalize)
  } catch (e) {
    console.error('[EmployeeFoodCalendar] loadMonth error:', e)
    requests.value = []
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

/* ───────── Click handler ───────── */
function selectDay(d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = listForDate(dateStr)

  selectedDate.value = dateStr

  if (list && list.length > 0) {
    Swal.fire({
      icon: 'info',
      title: `My food requests on ${dateStr}`,
      html: `
        <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
          ${list.map(r => `
            <div
              class="swal-food"
              data-id="${r._id}"
              style="
                margin-bottom:6px;
                padding:8px;
                border:1px solid #e2e8f0;
                border-radius:8px;
                background:#f8fafc;
                cursor:pointer;
                transition:background .2s;
              "
            >
              <div><b>${esc(r.employee?.name || '')}</b> (${esc(r.orderType)})</div>
              <div>🍱 Meals: ${esc(fmtMeals(r))}</div>
              <div>🕓 ${esc(fmtTimeRange(r))}</div>
              <div>🔢 Qty: ${r.quantity || 0}</div>
              <div>📍 ${esc(r.location?.kind || '')}</div>
              <div>Status: <b>${esc(r.status)}</b></div>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:10px;">
          <button id="createNewFoodBtn" class="swal2-confirm swal2-styled" style="background:#4f46e5">
            ➕ Create New
          </button>
        </div>
      `,
      showConfirmButton: false,
      width: 520,
      didOpen: () => {
        // Click existing request → go to history (focus)
        document.querySelectorAll('.swal-food').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id')
            Swal.close()
            router.push({
              name: 'employee-request-history',
              query: { focus: id, date: dateStr }
            })
          })
        })

        // Create new for this date
        const btn = document.getElementById('createNewFoodBtn')
        if (btn) {
          btn.addEventListener('click', () => {
            Swal.close()
            router.push({
              name: 'employee-request',
              query: { eatDate: dateStr }
            })
          })
        }
      }
    })
  } else {
    Swal.fire({
      icon: 'question',
      title: 'No food requests yet',
      text: `Do you want to create a request for ${dateStr}?`,
      showCancelButton: true,
      confirmButtonText: 'Yes, create request',
      cancelButtonText: 'No'
    }).then(res => {
      if (res.isConfirmed) {
        router.push({
          name: 'employee-request',
          query: { eatDate: dateStr }
        })
      }
    })
  }
}

/* ───────── Socket sync ───────── */
function upsert(doc) {
  const d = normalize(doc)
  const empId = doc?.employee?.employeeId || doc?.employeeId
  if (employeeId.value && String(empId) !== String(employeeId.value)) return

  const idx = requests.value.findIndex(x => x._id === d._id)
  if (idx === -1) requests.value.push(d)
  else requests.value[idx] = d
}
const onDeleted = ({ _id }) => removeById(String(_id || ''))

function removeById(id) {
  const idx = requests.value.findIndex(x => x._id === id)
  if (idx !== -1) requests.value.splice(idx, 1)
}

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
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg slim-card" elevation="1">
      <div class="calendar-wrapper">
        <!-- Toolbar -->
        <div class="calendar-toolbar">
          <div class="toolbar-left">
            <button class="btn-nav" @click="prevMonth">‹</button>
            <div class="month-label">{{ monthLabel }}</div>
            <button class="btn-nav" @click="nextMonth">›</button>
          </div>

          <div class="toolbar-right">
            <button class="btn-flat" @click="loadMonth">REFRESH</button>
            <button class="btn-flat today" @click="goToday">TODAY</button>
          </div>
        </div>

        <!-- Scrollable body -->
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

            <!-- Grid -->
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
                    v-for="(r, i) in byDate[d.format('YYYY-MM-DD')]"
                    :key="i"
                    class="booking-chip"
                    :style="{ backgroundColor: STATUS_COLOR[r.status] || '#94a3b8' }"
                  >
                    {{ r.orderType || 'Meal' }} ({{ r.quantity || 0 }})
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="status-legend">
          <div
            v-for="(color, status) in STATUS_COLOR"
            :key="status"
            class="legend-item"
          >
            <span class="legend-dot" :style="{ backgroundColor: color }"></span>
            {{ status }}
          </div>
        </div>

        <div v-if="loading" class="loader">Loading…</div>
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card {
  border: 1px solid rgba(100,116,139,.16);
}

.calendar-wrapper {
  border-radius: 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
}

/* Toolbar – same family as transport calendars */
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
  font-size: 1.05rem;
  color: #fff;
}

.btn-nav {
  background: rgba(255,255,255,.96);
  border: none;
  border-radius: 999px;
  font-size: 18px;
  width: 34px;
  height: 34px;
  cursor: pointer;
  color: #0f172a;
  box-shadow: 0 1px 4px rgba(15,23,42,.18);
}
.btn-nav:hover {
  background: #e5edff;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}
.btn-flat {
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: .85rem;
  cursor: pointer;
  color: #fff;
}
.btn-flat.today {
  background: #4f46e5;
  border-color: #c7d2fe;
}

/* Scrollable body (horizontal + vertical) */
.calendar-body {
  max-height: 460px;
  overflow-y: auto;
  overflow-x: auto;
}
.calendar-inner {
  min-width: 860px; /* ensures horizontal scroll on narrow screens */
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
.day-cell:hover {
  background: #f8fafc;
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
  border-radius: 999px;
  padding: 2px 6px;
  font-size: 0.78rem;
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

/* SweetAlert hover helper (just in case) */
:deep(.swal-food:hover) {
  background-color: #e0f2fe !important;
}

/* Mobile tweaks */
@media (max-width: 600px) {
  .slim-card {
    border-left: none;
    border-right: none;
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
