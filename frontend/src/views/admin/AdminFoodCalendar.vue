<!-- src/views/admin/AdminFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import Swal from 'sweetalert2'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

const router = useRouter()
const auth = useAuth()

/* ───────── constants ───────── */
const COLOR = {
  NEW:       '#94a3b8',
  ACCEPTED:  '#6366f1',
  COOKING:   '#f97316',
  READY:     '#0d9488',
  DELIVERED: '#16a34a',
  CANCELED:  '#ef4444',
}

/* ───────── state ───────── */
const currentMonth = ref(dayjs())
const loading      = ref(false)
const rows         = ref([]) // normalized food requests

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—')
const fmtTimeRange = r =>
  (r?.eatTimeStart || r?.eatTimeEnd)
    ? [r.eatTimeStart || '', r.eatTimeEnd || ''].filter(Boolean).join(' – ')
    : '—'

const asArray = v => (Array.isArray(v) ? v : [])

const normalize = o => {
  const eat = o?.eatDate || o?.serveDate || null
  return {
    ...o,
    _id: String(o?._id || ''),
    requestId: String(o?.requestId || ''),
    orderType: o?.orderType || '',
    quantity: Number(o?.quantity || 0),
    meals: asArray(o?.meals),
    location: o?.location || {},
    menuChoices: asArray(o?.menuChoices),
    menuCounts: asArray(o?.menuCounts),
    dietary: asArray(o?.dietary),
    dietaryCounts: asArray(o?.dietaryCounts),
    specialInstructions: o?.specialInstructions || '',
    dietaryOther: o?.dietaryOther || '',
    cancelReason: o?.cancelReason || '',
    recurring: o?.recurring || {},
    status: o?.status || 'NEW',
    statusHistory: asArray(o?.statusHistory),
    notified: o?.notified || {},
    stepDates: o?.stepDates || {},
    orderDate: o?.orderDate || null,
    eatDate: eat,
    serveDate: o?.serveDate || null,
    createdAt: o?.createdAt || null,
    updatedAt: o?.updatedAt || null,
    employee: o?.employee || {},
    eatTimeStart: o?.eatTimeStart || '',
    eatTimeEnd: o?.eatTimeEnd || '',
  }
}

/* ───────── group by date ───────── */
const byDate = computed(() => {
  const map = {}
  for (const r of rows.value) {
    const key = fmtDate(r.eatDate) || fmtDate(r.serveDate)
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

function dateList(dateStr) {
  const list = byDate.value[dateStr] || []
  return list.slice().sort((a, b) => {
    const tA = (a.eatTimeStart || '') + (a.eatTimeEnd || '')
    const tB = (b.eatTimeStart || '') + (b.eatTimeEnd || '')
    return (
      tA.localeCompare(tB) ||
      (a.status || '').localeCompare(b.status || '') ||
      (a.employee?.name || '').localeCompare(b.employee?.name || '')
    )
  })
}
const dayHasOrders = (dateStr) => dateList(dateStr).length > 0

/* ───────── month grid (same style as transportation) ───────── */
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

/* ───────── load month (range, with fallback) ───────── */
async function loadMonth () {
  loading.value = true
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    let { data } = await api.get('/admin/food-requests', {
      params: { from, to }
    })

    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    // Fallback if server ignores from/to
    if (!Array.isArray(list) || list.length === 0) {
      const resp2 = await api.get('/admin/food-requests')
      data = resp2.data
      list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    }

    rows.value = (list || []).map(normalize)
  } catch (e) {
    console.error('[AdminFoodCalendar] loadMonth error:', e)
    rows.value = []
  } finally {
    loading.value = false
  }
}

/* ───────── realtime upsert/remove ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(x => x._id === d._id)
  if (i === -1) rows.value.push(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const idx = rows.value.findIndex(x => x._id === id)
  if (idx !== -1) rows.value.splice(idx, 1)
}

/* ───────── navigation (same as transport) ───────── */
function nextMonth () {
  currentMonth.value = currentMonth.value.add(1, 'month')
}
function prevMonth () {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
}
function goToday () {
  currentMonth.value = dayjs()
}

/* ───────── click handler (popup + route to AdminFoodRequests) ───────── */
function showDayDetails (d) {
  const dateStr = d.format('YYYY-MM-DD')
  const list = dateList(dateStr)

  if (!list?.length) {
    Swal.fire({
      icon: 'info',
      title: `No requests on ${dateStr}`,
      confirmButtonText: 'OK'
    })
    return
  }

  Swal.fire({
    icon: 'info',
    title: `Requests on ${dateStr}`,
    html: `
      <div style="text-align:left;max-height:280px;overflow:auto;padding:5px 0">
        ${list
          .map(
            (r) => `
          <div style="
                margin-bottom:6px;
                padding:8px;
                border:1px solid #e2e8f0;
                border-radius:8px;
                background:#f8fafc;
                cursor:pointer
              "
               onclick="window.__selectFood('${r._id}')">
            <div><b>${(r.employee?.name || '').replace(/</g,'&lt;')}</b> (${r.orderType || '—'})</div>
            <div>🕓 ${fmtTimeRange(r)}</div>
            <div>🍱 Qty: ${r.quantity || 0}</div>
            <div>Status: <b>${r.status}</b></div>
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
      const role = auth.user?.role || localStorage.getItem('authRole') || ''
      const targetRoute =
        role === 'CHEF'
          ? 'chef-requests'
          : 'admin-requests'

      window.__selectFood = (id) => {
        Swal.close()
        router.push({
          name: targetRoute,
          query: { focus: id, date: dateStr }
        })
      }
    },
    willClose: () => {
      delete window.__selectFood
    }
  })
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await loadMonth()

  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id || '')))
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})

watch(currentMonth, () => loadMonth())
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
          <button class="pill-btn pill-muted" @click="loadMonth">
            REFRESH
          </button>
          <button class="pill-btn pill-primary" @click="goToday">
            TODAY
          </button>
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
              otherMonth: !d.isSame(currentMonth, 'month')
            }"
            @click="showDayDetails(d)"
          >
            <div class="day-number" :class="{ sunday: d.day() === 0 }">
              {{ d.date() }}
            </div>

            <div v-if="byDate[d.format('YYYY-MM-DD')]" class="bookings">
              <div
                v-for="(r,i) in byDate[d.format('YYYY-MM-DD')]"
                :key="i"
                class="booking-chip"
                :style="{ backgroundColor: COLOR[r.status] || '#94a3b8' }"
              >
                {{ r.employee?.name || r.employee?.employeeId || '—' }}
                ({{ r.quantity || 0 }})
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="status-legend">
      <div
        v-for="(color, status) in COLOR"
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

/* ── Gradient header ── */
.calendar-hero {
  padding: 12px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.circle-btn i {
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
  min-width: 720px; /* scroll horizontally on narrow devices */
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

/* chips */
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
