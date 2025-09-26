<!-- src/views/admin/AdminFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

/* ---------------- Debug ---------------- */
const DEBUG = true

/* ---------------- State ---------------- */
const month = ref(dayjs().month())   // 0..11 (local)
const year  = ref(dayjs().year())    // 4-digit

const gridDays = ref([])             // [{ date:'YYYY-MM-DD', inMonth:true/false }, …]
const rows = ref([])                 // rows in current month window (by eatDate)
const byDate = ref(new Map())        // 'YYYY-MM-DD' -> rows[]
const topStatusByDate = ref(new Map())

const loading = ref(false)
const dialog = ref(false)
const selectedDate = ref('')
const selectedRows = ref([])

/* ---------------- Visuals ---------------- */
const COLOR = {
  NEW:'#9ca3af',
  ACCEPTED:'#1e88e5',
  COOKING:'#fb8c00',
  READY:'#0d9488',
  DELIVERED:'#22c55e',
  CANCELED:'#e53935'
}
const CELL_BG = {
  NEW:'rgba(156,163,175,.15)',
  ACCEPTED:'rgba(30,136,229,.12)',
  COOKING:'rgba(251,140,0,.12)',
  READY:'rgba(13,148,136,.14)',
  DELIVERED:'rgba(34,197,94,.18)',
  CANCELED:'rgba(229,57,53,.12)'
}
// higher index “wins”
const STATUS_PRIORITY = ['CANCELED','NEW','ACCEPTED','COOKING','READY','DELIVERED']
const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/* ---------------- Dates (local) ---------------- */
const mStart = computed(() => dayjs().year(year.value).month(month.value).startOf('month'))
const mEnd   = computed(() => mStart.value.endOf('month'))
const gStart = computed(() => mStart.value.startOf('week'))
const gEnd   = computed(() => mEnd.value.endOf('week'))
const monthLabel = computed(() => mStart.value.format('MMMM'))

/* ---------------- Helpers ---------------- */
const fmt = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

function pickHigher(a,b){
  if (!a) return b
  return STATUS_PRIORITY.indexOf(b) > STATUS_PRIORITY.indexOf(a) ? b : a
}

function buildGrid() {
  const out = []
  let cur = gStart.value
  while (cur.isBefore(gEnd.value) || cur.isSame(gEnd.value, 'day')) {
    out.push({ date: fmt(cur), inMonth: cur.month() === month.value })
    cur = cur.add(1,'day')
  }
  gridDays.value = out
  if (DEBUG) console.log('[Calendar] grid built', {
    start: gStart.value.format('YYYY-MM-DD'),
    end: gEnd.value.format('YYYY-MM-DD'),
    cells: out.length
  })
}

/* Group rows by date and compute top status/day */
function regroup() {
  const map = new Map()
  for (const r of rows.value) {
    const key = fmt(r.eatDate)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  byDate.value = map

  const tops = new Map()
  for (const [d, list] of map.entries()) {
    let s = null
    for (const r of list) s = pickHigher(s, r.status)
    tops.set(d, s)
  }
  topStatusByDate.value = tops

  if (DEBUG) {
    const summary = [...byDate.value.entries()]
      .map(([d, list]) => ({
        date: d,
        count: list.length,
        ids: list.map(x => x.requestId),
        topStatus: topStatusByDate.value.get(d)
      }))
      .sort((a,b) => a.date.localeCompare(b.date))
    console.log('[Calendar] grouped by eatDate:', summary)
  }
}

/* ---------------- Fetch (server filtered by eatDate) ---------------- */
async function fetchMonth() {
  loading.value = true
  const from = mStart.value.format('YYYY-MM-DD')
  const to   = mEnd.value.format('YYYY-MM-DD')

  if (DEBUG) console.log('[Calendar] Fetch month', { from, to })

  try {
    const url = `/admin/food-requests?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=5000`
    const { data } = await api.get(url)
    const out = Array.isArray(data) ? data : (data?.rows || data?.data || [])

    // guard against any backend that might still return more
    const startTs = mStart.value.valueOf()
    const endTs   = mEnd.value.endOf('day').valueOf()

    rows.value = out.filter(r => {
      const t = r?.eatDate ? dayjs(r.eatDate).valueOf() : NaN
      return Number.isFinite(t) && t >= startTs && t <= endTs
    })

    if (DEBUG) {
      console.log('[Calendar] server returned:', out.length, ' kept:', rows.value.length)
      console.log('[Calendar] kept rows (by eatDate in month):',
        rows.value.map(r => ({
          id: r.requestId,
          eatDate: dayjs(r.eatDate).format('YYYY-MM-DD'),
          status: r.status,
          qty: r.quantity
        }))
      )
    }

    regroup()
  } catch (e) {
    console.error('[Calendar] fetch failed:', e?.response?.data || e)
  } finally {
    loading.value = false
  }
}

/* ---------------- Actions ---------------- */
function openDay(d) {
  selectedDate.value = d
  selectedRows.value = (byDate.value.get(d) || []).slice().sort((a,b) =>
    (a.orderType||'').localeCompare(b.orderType||'') ||
    (a.employee?.name||'').localeCompare(b.employee?.name||'')
  )
  if (DEBUG) {
    console.log('[Calendar] openDay', d, 'rows:',
      selectedRows.value.map(r => ({
        id: r.requestId,
        eatDate: dayjs(r.eatDate).format('YYYY-MM-DD'),
        status: r.status,
        qty: r.quantity
      }))
    )
  }
  dialog.value = true
}

async function nextMonth() {
  const dt = mStart.value.add(1, 'month')
  year.value = dt.year()
  month.value = dt.month()
  buildGrid()
  await fetchMonth()
}
async function prevMonth() {
  const dt = mStart.value.subtract(1, 'month')
  year.value = dt.year()
  month.value = dt.month()
  buildGrid()
  await fetchMonth()
}
async function today() {
  const dt = dayjs()
  year.value = dt.year()
  month.value = dt.month()
  buildGrid()
  await fetchMonth()
}

/* ---------------- UI helpers ---------------- */
function cellStyle(c) {
  const s = topStatusByDate.value.get(c.date)
  return {
    backgroundColor: s ? CELL_BG[s] : '',
    border: '1px solid rgba(0,0,0,.06)',
    opacity: c.inMonth ? 1 : .45
  }
}
const chipColor = s => COLOR[s] || '#9ca3af'

/* ---------------- Lifecycle ---------------- */
onMounted(async () => {
  buildGrid()
  await fetchMonth()
})
</script>

<template>
  <v-container fluid>
    <v-card elevation="2" class="rounded-lg">
      <v-toolbar flat density="comfortable">
        <v-toolbar-title class="font-weight-bold">
          📅 Food Request Calendar — {{ monthLabel }} {{ year }}
        </v-toolbar-title>
        <v-spacer />
        <v-btn variant="tonal" class="mr-1" @click="today">Today</v-btn>
        <v-btn variant="tonal" class="mr-1" @click="prevMonth">Prev</v-btn>
        <v-btn variant="tonal" color="primary" :loading="loading" @click="nextMonth">Next</v-btn>
      </v-toolbar>

      <v-divider />

      <!-- header -->
      <div class="px-3 pt-3 pb-1 d-flex">
        <div v-for="n in dayNames" :key="n" class="dow">{{ n }}</div>
      </div>

      <!-- grid -->
      <div class="px-3 pb-3 calendar-grid">
        <div
          v-for="d in gridDays"
          :key="d.date"
          class="cell"
          :style="cellStyle(d)"
          @click="openDay(d.date)"
        >
          <div class="cell-top">
            <span class="date">{{ d.date.slice(-2) }}</span>
            <v-chip
              v-if="byDate.get(d.date)?.length"
              size="x-small"
              label
              color="teal"
              variant="tonal"
            >
              {{ byDate.get(d.date)?.length }}
            </v-chip>
          </div>
          <div class="cell-body">
            <div
              v-if="topStatusByDate.get(d.date)"
              class="status-dot"
              :style="{ backgroundColor: chipColor(topStatusByDate.get(d.date)) }"
              :title="topStatusByDate.get(d.date)"
            />
          </div>
        </div>
      </div>
    </v-card>

    <!-- Day details -->
    <v-dialog v-model="dialog" max-width="960px">
      <v-card class="rounded-xl">
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2" color="primary">mdi-calendar</v-icon>
          <span class="text-h6">Requests on {{ selectedDate }}</span>
          <v-spacer />
          <v-chip color="teal" variant="tonal" size="small" label>
            {{ selectedRows.length }} item(s)
          </v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Req ID</th>
                <th>Employee</th>
                <th>Dept</th>
                <th>Type</th>
                <th>Meals</th>
                <th>Qty</th>
                <th>Location</th>
                <th>Menus</th>
                <th>Dietary</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in selectedRows" :key="r._id">
                <td><v-chip :color="chipColor(r.status)" size="x-small" label>{{ r.status }}</v-chip></td>
                <td>{{ r.requestId }}</td>
                <td>{{ r.employee?.name }}</td>
                <td>{{ r.employee?.department }}</td>
                <td>{{ r.orderType }}</td>
                <td>{{ (r.meals || []).join(', ') }}</td>
                <td>{{ r.quantity }}</td>
                <td>{{ r.location?.kind }}<span v-if="r.location?.other"> — {{ r.location.other }}</span></td>
                <td>{{ (r.menuChoices || []).join(', ') }}</td>
                <td>
                  <span v-if="(r.dietary || []).length">{{ r.dietary.join(', ') }}</span>
                  <span v-else>—</span>
                </td>
              </tr>
              <tr v-if="!selectedRows.length">
                <td colspan="10" class="text-center text-medium-emphasis py-6">No requests.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn text color="primary" @click="dialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.dow{
  flex:1;
  text-align:center;
  font-weight:600;
  opacity:.75;
}
.calendar-grid{
  display:grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 110px;
  gap:8px;
}
.cell{
  border-radius:10px;
  padding:8px;
  cursor:pointer;
  display:flex;
  flex-direction:column;
}
.cell:hover{ outline:2px solid rgba(59,130,246,.35); }
.cell-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.date{ font-weight:700; opacity:.85; }
.cell-body{ flex:1; display:flex; align-items:flex-end; }
.status-dot{
  width:12px; height:12px; border-radius:999px;
  box-shadow:0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,.15);
}
</style>
