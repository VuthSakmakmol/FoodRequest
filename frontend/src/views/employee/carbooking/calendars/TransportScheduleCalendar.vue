<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'

/* ---------- props ---------- */
const props = defineProps({
  modelValue: { type: String, default: () => dayjs().format('YYYY-MM-DD') },
  startHour:  { type: String, default: '06' },  // day start (HH)
  endHour:    { type: String, default: '22' },  // day end   (HH)
  minuteStep: { type: Number, default: 30 },
  maxCar:     { type: Number, default: 3 },     // fallback if no drivers fetched
  maxMsgr:    { type: Number, default: 1 },     // fallback if no messengers fetched
})
const emit = defineEmits(['update:modelValue'])

/* ---------- helpers ---------- */
const toMin = (hhmm) => { const [h='0',m='0']=String(hhmm||'').split(':'); return (+h)*60+(+m) }
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE
const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

/* ---------- state ---------- */
const selectedDate = ref(props.modelValue)
watch(() => props.modelValue, v => { selectedDate.value = v || dayjs().format('YYYY-MM-DD') })
watch(selectedDate, v => emit('update:modelValue', v))

const loading   = ref(false)
const err       = ref('')
const bookings  = ref([])

/* fetched people for lane labels/capacity */
const drivers    = ref([])  // [{_id, loginId, name}]
const messengers = ref([])

/* ---------- FILTERS ---------- */
const STAT_LIST = ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','DELAYED','COMPLETED','CANCELLED']

const filters = ref({
  category: 'ALL',    // ALL | Car | Messenger
  status:   'ALL',    // ALL | one of STAT_LIST
  driverId: 'ALL',    // 'ALL' or actual driverId
  q: '',              // search: employee/purpose/driver
  timeStart: '',      // HH:mm
  timeEnd:   '',      // HH:mm
  includeCancelled: false
})

/* set sensible time min/max and reset when date changes */
const dayStartHH = computed(() => String(props.startHour).padStart(2,'0'))
const dayEndHH   = computed(()   => String(props.endHour).padStart(2,'0'))
const timeMin = computed(() => `${dayStartHH.value}:00`)
const timeMax = computed(() => `${dayEndHH.value}:00`)

/* when date changes -> clear the time window & fetch */
watch(selectedDate, () => {
  filters.value.timeStart = ''
  filters.value.timeEnd   = ''
  fetchDay()
})

/* also refetch if user adjusts time window (server still returns day, but harmless) */
watch(() => [filters.value.timeStart, filters.value.timeEnd], () => {
  fetchDay()
})

/* ---------- driver options (from today's bookings or fetched list) ---------- */
const driverOptions = computed(() => {
  // Prefer fetched drivers list; fall back to names in bookings for today.
  if (drivers.value?.length) {
    return [{ title:'ALL', value:'ALL' }, ...drivers.value.map(d => ({ title: d.name || d.loginId, value: d._id || d.loginId })) ]
  }
  const dict = new Map()
  for (const b of bookings.value) {
    const id = b?.assignment?.driverId || ''
    const nm = b?.assignment?.driverName || ''
    if (id) dict.set(id, nm || id)
  }
  return [{ title:'ALL', value:'ALL' }, ...Array.from(dict, ([value, title]) => ({ title, value })) ]
})

/* ---------- apply filters (client-side) ---------- */
const filteredBookings = computed(() => {
  const f = filters.value
  const hasWindow = f.timeStart && f.timeEnd && toMin(f.timeEnd) > toMin(f.timeStart)
  const winS = hasWindow ? toMin(f.timeStart) : null
  const winE = hasWindow ? toMin(f.timeEnd)   : null
  const q = (f.q || '').trim().toLowerCase()

  return bookings.value.filter(b => {
    if (f.category !== 'ALL' && b.category !== f.category) return false
    if (!f.includeCancelled && b.status === 'CANCELLED') return false
    if (f.status !== 'ALL' && b.status !== f.status) return false
    if (f.driverId !== 'ALL' && (b?.assignment?.driverId || '') !== f.driverId) return false
    if (q) {
      const emp = (b?.employee?.name || b.employeeId || '').toLowerCase()
      const pur = (b?.purpose || '').toLowerCase()
      const drv = (b?.assignment?.driverName || '').toLowerCase()
      if (!emp.includes(q) && !pur.includes(q) && !drv.includes(q)) return false
    }
    if (hasWindow) {
      const bs = toMin(b.timeStart), be = toMin(b.timeEnd)
      if (!overlaps(winS, winE, bs, be)) return false
    }
    return true
  })
})

/* ---------- geometry ---------- */
const startMin = computed(() => Number(props.startHour)*60)
const endMin   = computed(() => Number(props.endHour)*60)
const totalMin = computed(() => endMin.value - startMin.value)
const cols     = computed(() => Math.ceil(totalMin.value / props.minuteStep))
const colLabels = computed(() => {
  const out = []
  for (let k = 0; k <= cols.value; k++) {
    const m = startMin.value + k*props.minuteStep
    const h = Math.floor(m/60), mm = m%60
    out.push(`${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`)
  }
  return out
})

/* ---------- API ---------- */
async function fetchDay() {
  if (!selectedDate.value) return
  loading.value = true; err.value = ''
  try {
    const { data } = await api.get('/admin/car-bookings', { params: { date: selectedDate.value }})
    bookings.value = Array.isArray(data) ? data : []
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
  } finally {
    loading.value = false
  }
}
async function fetchPeople() {
  try {
    const [drv, msg] = await Promise.all([
      api.get('/admin/users', { params: { role: 'DRIVER', isActive: true } }),
      api.get('/admin/users', { params: { role: 'MESSENGER', isActive: true } }),
    ])
    drivers.value    = Array.isArray(drv?.data) ? drv.data : []
    messengers.value = Array.isArray(msg?.data) ? msg.data : []
  } catch (e) {
    // non-fatal, we keep fallbacks
    console.warn('fetchPeople failed:', e?.message || e)
  }
}

/* ---------- realtime ---------- */
function onDelta() { fetchDay() }
onMounted(async () => {
  await Promise.all([fetchDay(), fetchPeople()])
  window.addEventListener('resize', updateCellWidth)
  socket.on('carBooking:created', onDelta)
  socket.on('carBooking:updated', onDelta)
  socket.on('carBooking:deleted', onDelta)
  socket.on('carBooking:status',  onDelta)
  socket.on('carBooking:assigned',onDelta)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCellWidth)
  socket.off('carBooking:created', onDelta)
  socket.off('carBooking:updated', onDelta)
  socket.off('carBooking:deleted', onDelta)
  socket.off('carBooking:status',  onDelta)
  socket.off('carBooking:assigned',onDelta)
})

/* ---------- pack into lanes ---------- */
const STAT_COLORS = {
  PENDING:   '#9CA3AF',
  ACCEPTED:  '#EF4444',
  ON_ROAD:   '#0EA5E9',
  ARRIVING:  '#10B981',
  COMPLETED: '#22C55E',
  DELAYED:   '#F59E0B',
  CANCELLED: '#94A3B8',
}
function pack(category, capacity) {
  const src = filteredBookings.value.filter(b => b.category === category)
  const items = src.map(b => ({
    id: String(b._id),
    start: clamp(toMin(b.timeStart), startMin.value, endMin.value),
    end:   clamp(toMin(b.timeEnd),   startMin.value, endMin.value),
    rawStart: b.timeStart, rawEnd: b.timeEnd,
    status: b.status,
    emp: b.employee?.name || b.employeeId || '',
    purpose: b.purpose || '',
  }))
  .filter(x => x.end > x.start)
  .sort((a,b) => a.start - b.start || a.end - b.end)

  const lanes = Array.from({ length: capacity }, () => [])
  for (const job of items) {
    let placed = false
    for (const lane of lanes) {
      const clash = lane.some(x => overlaps(x.start, x.end, job.start, job.end))
      if (!clash) { lane.push(job); placed = true; break }
    }
    if (!placed) lanes[lanes.length - 1].push({ ...job, overbooked: true })
  }
  return lanes
}

/* capacities & labels from DB (fallback to props) */
const carCapacity  = computed(() => drivers.value?.length ? drivers.value.length : props.maxCar)
const msgCapacity  = computed(() => messengers.value?.length ? messengers.value.length : props.maxMsgr)
const carLanes     = computed(() => pack('Car', carCapacity.value))
const msgLanes     = computed(() => pack('Messenger', msgCapacity.value))

/* position helpers */
function leftPct(mins) {
  const dx = clamp(mins - startMin.value, 0, totalMin.value)
  return `${(dx / totalMin.value) * 100}%`
}
function widthPct(sMin, eMin) {
  const w = clamp(eMin - sMin, 0, totalMin.value)
  return `${(w / totalMin.value) * 100}%`
}

/* ---------- responsive timeline + synced header/body scroll ---------- */
const cardRef = ref(null)
const headerColsRef = ref(null)
const bodyColsRef = ref(null)
const cellW = ref(160) // 160 / 120 / 90 based on available width
const gapW  = 8
const gridPx = computed(() => (cols.value * cellW.value) + ((cols.value - 1) * gapW))

function updateCellWidth() {
  const w = cardRef.value?.clientWidth || window.innerWidth
  if (w < 700) cellW.value = 90
  else if (w < 1100) cellW.value = 120
  else cellW.value = 160
}
onMounted(async () => {
  await nextTick()
  updateCellWidth()
  const h = headerColsRef.value
  const b = bodyColsRef.value
  if (h && b) {
    const onH = () => { b.scrollLeft = h.scrollLeft }
    const onB = () => { h.scrollLeft = b.scrollLeft }
    h.addEventListener('scroll', onH)
    b.addEventListener('scroll', onB)
    onBeforeUnmount(() => {
      h.removeEventListener('scroll', onH)
      b.removeEventListener('scroll', onB)
    })
  }
})

/* ---------- now-availability ---------- */
const nowSlice = computed(() => {
  const now = dayjs()
  if (now.format('YYYY-MM-DD') !== selectedDate.value) return null
  const m = now.hour()*60 + now.minute()
  if (m < startMin.value || m >= endMin.value) return null
  const slotStart = Math.floor((m - startMin.value)/props.minuteStep)*props.minuteStep + startMin.value
  const slotEnd   = slotStart + props.minuteStep
  const count = (cat) => bookings.value
    .filter(b => b.category === cat && b.status !== 'CANCELLED')
    .filter(b => overlaps(slotStart, slotEnd, toMin(b.timeStart), toMin(b.timeEnd))).length
  return { start: slotStart, end: slotEnd, busyCar: count('Car'), busyMsgr: count('Messenger') }
})
const availCarNow  = computed(() => nowSlice.value ? Math.max(0, carCapacity.value - nowSlice.value.busyCar)  : null)
const availMsgrNow = computed(() => nowSlice.value ? Math.max(0, msgCapacity.value - nowSlice.value.busyMsgr) : null)

/* legend */
const LEGEND = [
  ['PENDING','Pending'],
  ['ACCEPTED','Accepted'],
  ['ON_ROAD','On the way'],
  ['ARRIVING','Arriving'],
  ['DELAYED','Delayed'],
  ['COMPLETED','Completed'],
  ['CANCELLED','Cancelled'],
]
</script>

<template>
  <div ref="cardRef" class="transport-cal">
    <!-- ================= FILTERS (fully responsive; date/time drive fetch) ================= -->
    <div class="toolbar">
      <div class="filters-grid">
        <!-- Date -->
        <div class="fg-item fg-date">
          <label>Date</label>
          <div class="date-ctrl">
            <button class="btn-icon" @click="selectedDate = dayjs(selectedDate).subtract(1,'day').format('YYYY-MM-DD')">‹</button>
            <input class="input tall" type="date" :value="selectedDate" @input="e => selectedDate = e.target.value" />
            <button class="btn-icon" @click="selectedDate = dayjs(selectedDate).add(1,'day').format('YYYY-MM-DD')">›</button>
          </div>
        </div>

        <!-- Category -->
        <div class="fg-item">
          <label>Category</label>
          <select class="input tall" v-model="filters.category">
            <option>ALL</option><option>Car</option><option>Messenger</option>
          </select>
        </div>

        <!-- Status -->
        <div class="fg-item">
          <label>Status</label>
          <select class="input tall" v-model="filters.status">
            <option>ALL</option>
            <option v-for="s in STAT_LIST" :key="s">{{ s }}</option>
          </select>
        </div>

        <!-- Driver -->
        <div class="fg-item">
          <label>Driver</label>
          <select class="input tall" v-model="filters.driverId">
            <option :value="'ALL'">ALL</option>
            <option v-for="opt in driverOptions" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
          </select>
        </div>

        <!-- Search -->
        <div class="fg-item fg-span2">
          <label>Search name / purpose / driver</label>
          <input class="input tall" type="text" v-model="filters.q" placeholder="Search…" />
        </div>

        <!-- Time window (follows day bounds) -->
        <div class="fg-item">
          <label>From</label>
          <input class="input tall" type="time" v-model="filters.timeStart" :min="timeMin" :max="timeMax" step="60">
        </div>
        <div class="fg-item">
          <label>To</label>
          <input class="input tall" type="time" v-model="filters.timeEnd" :min="timeMin" :max="timeMax" step="60">
        </div>

        <label class="fg-item checkbox">
          <input type="checkbox" v-model="filters.includeCancelled" />
          <span>Include cancelled</span>
        </label>
      </div>
    </div>

    <!-- ================= Legend ================= -->
    <div class="legend">
      <div v-for="[k, label] in LEGEND" :key="k" class="legend-item">
        <span class="dot" :style="{ background: STAT_COLORS[k] || '#999' }"></span>
        <span class="lbl">{{ label }}</span>
      </div>
    </div>

    <div v-if="err" class="alert">{{ err }}</div>

    <!-- ================= Timeline header (synced scroll) ================= -->
    <div class="grid header">
      <div class="lane-col head sticky">Time</div>
      <div class="cols" ref="headerColsRef">
        <div class="cols-inner" :style="{ width: gridPx + 'px' }">
          <div v-for="(lab, i) in colLabels" :key="i" class="col" :style="{ width: cellW + 'px' }">
            <span class="tick" v-if="i < colLabels.length-1">{{ lab }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Cars ================= -->
    <div v-if="filters.category === 'ALL' || filters.category === 'Car'">
      <div class="section-title">🚗 Cars ({{ carCapacity }})</div>
      <div class="grid">
        <div class="lane-col sticky">
          <div
            v-for="(d, i) in (drivers.length ? drivers : Array.from({length: carCapacity}, (_,k)=>({name:`Car #${k+1}`})))"
            :key="'car-lbl-'+(d._id || i)"
            class="lane-label"
          >
            {{ d.name || d.loginId || `Car #${i+1}` }}
          </div>
        </div>

        <div class="cols body" ref="bodyColsRef">
          <div class="cols-inner" :style="{ width: gridPx + 'px' }">
            <div v-for="i in carCapacity" :key="'car-row-'+i" class="row-bg"
                 :style="{ gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, columnGap: '8px' }">
              <div v-for="c in cols" :key="'car-cell-'+i+'-'+c" class="cell"></div>
            </div>

            <template v-for="(lane, li) in carLanes" :key="'car-lane-'+li">
              <div class="lane-overlay" style="height:44px">
                <div
                  v-for="b in lane"
                  :key="b.id"
                  class="block"
                  :class="{ over: b.overbooked }"
                  :style="{
                    left: leftPct(b.start),
                    width: widthPct(b.start, b.end),
                    borderColor: STAT_COLORS[b.status] || '#888',
                    background: (b.status==='CANCELLED' ? '#fff' : (STAT_COLORS[b.status] + '22'))
                  }"
                  :title="`${b.rawStart}–${b.rawEnd} • ${b.status}${b.overbooked?' (over capacity)':''}`"
                >
                  <div class="block-bar" :style="{ background: STAT_COLORS[b.status] || '#888' }"></div>
                  <div class="block-text">
                    <div class="t">{{ b.rawStart }}–{{ b.rawEnd }}</div>
                    <div class="s">{{ b.status }}</div>
                    <div class="p" v-if="b.emp">{{ b.emp }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Messenger ================= -->
    <div v-if="filters.category === 'ALL' || filters.category === 'Messenger'">
      <div class="section-title">🛵 Messenger ({{ msgCapacity }})</div>
      <div class="grid">
        <div class="lane-col sticky">
          <div
            v-for="(m, i) in (messengers.length ? messengers : Array.from({length: msgCapacity}, (_,k)=>({name:`Messenger #${k+1}`})))"
            :key="'msg-lbl-'+(m._id || i)"
            class="lane-label"
          >
            {{ m.name || m.loginId || `Messenger #${i+1}` }}
          </div>
        </div>

        <div class="cols body">
          <div class="cols-inner" :style="{ width: gridPx + 'px' }">
            <div v-for="i in msgCapacity" :key="'msg-row-'+i" class="row-bg"
                 :style="{ gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, columnGap: '8px' }">
              <div v-for="c in cols" :key="'msg-cell-'+i+'-'+c" class="cell"></div>
            </div>

            <template v-for="(lane, li) in msgLanes" :key="'msg-lane-'+li">
              <div class="lane-overlay" style="height:44px">
                <div
                  v-for="b in lane"
                  :key="b.id"
                  class="block"
                  :class="{ over: b.overbooked }"
                  :style="{
                    left: leftPct(b.start),
                    width: widthPct(b.start, b.end),
                    borderColor: STAT_COLORS[b.status] || '#888',
                    background: (b.status==='CANCELLED' ? '#fff' : (STAT_COLORS[b.status] + '22'))
                  }"
                  :title="`${b.rawStart}–${b.rawEnd} • ${b.status}${b.overbooked?' (over capacity)':''}`"
                >
                  <div class="block-bar" :style="{ background: STAT_COLORS[b.status] || '#888' }"></div>
                  <div class="block-text">
                    <div class="t">{{ b.rawStart }}–{{ b.rawEnd }}</div>
                    <div class="s">{{ b.status }}</div>
                    <div class="p" v-if="b.emp">{{ b.emp }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= chips ================= -->
    <div class="nowchips">
      <span v-if="availCarNow !== null" class="chip blue">🚗 Now: {{ availCarNow }} / {{ carCapacity }} free</span>
      <span v-if="availMsgrNow !== null" class="chip amber">🛵 Now: {{ availMsgrNow }} / {{ msgCapacity }} free</span>
    </div>

    <div v-if="loading" class="loader"></div>
  </div>
</template>

<style scoped>
.transport-cal{ border:1px solid rgba(100,116,139,.16); border-radius:12px; background:#fff; overflow:hidden; font-family: system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial, 'Noto Sans'; }

/* ───────── FILTERS ───────── */
.toolbar{ background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); padding: 12px 14px 8px; }
.filters-grid{ display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; align-items:end; }
.fg-item{ display:flex; flex-direction:column; gap:6px; }
.fg-item>label{ font-size:.86rem; color:#374151; font-weight:600; }
.fg-date .date-ctrl{ display:flex; gap:8px; align-items:center; }
.fg-span2{ grid-column: span 2; }
@media (max-width: 720px){ .fg-span2{ grid-column: span 1; } }

.input{ width:100%; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-size:.95rem; outline:none; background:#fff; }
.input:focus{ border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.15); }
.tall{ min-height:46px; }

.btn-icon{ width:38px; height:38px; border-radius:8px; border:1px solid #cbd5e1; background:#fff; font-size:18px; line-height:1; cursor:pointer; }
.btn-icon:hover{ background:#f3f4f6; }

.checkbox{ display:flex; align-items:center; gap:8px; padding-bottom:4px; }
.checkbox input{ width:18px; height:18px; }

/* ───────── LEGEND ───────── */
.legend{ display:flex; flex-wrap:wrap; gap:10px; padding:10px 14px 6px; }
.legend-item{ display:flex; align-items:center; gap:8px; color:#1f2937; }
.dot{ width:12px; height:12px; border-radius:999px; display:inline-block; }
.lbl{ font-size:.85rem; }

.alert{ margin: 8px 14px; padding:8px 12px; border-left:4px solid #ef4444; background:#fee2e2; color:#991b1b; border-radius:6px; }

/* ───────── TIMELINE ───────── */
.section-title{ font-weight:800; padding:10px 14px; color:#111827; letter-spacing:.2px; }

.grid{ display:grid; grid-template-columns: 180px 1fr; column-gap: 8px; padding: 0 14px 6px 14px; }
.grid.header{ padding-top: 6px; }
.sticky{ position: sticky; left:0; z-index:3; background:#fff; border-right:1px solid rgba(148,163,184,.25); }

.lane-col{ display:flex; flex-direction:column; gap:10px; }
.lane-col.head{ font-weight:700; color:#334155; display:flex; align-items:center; }
.lane-label{ height:44px; display:flex; align-items:center; font-weight:600; color:#374151; padding-right:6px; }

/* scroll */
.cols{ position: relative; overflow-x:auto; overflow-y:hidden; padding-bottom:2px; }
.cols::-webkit-scrollbar{ height:10px; }
.cols::-webkit-scrollbar-thumb{ background:#cbd5e1; border-radius:999px; }
.cols-inner{ position: relative; }

.grid.header .col{ display:inline-block; height:24px; margin-right:8px; position:relative; vertical-align:top; }
.tick{ position:absolute; left:0; top:2px; font-size:.78rem; color:#475569; font-weight:600; }

/* rows */
.row-bg{ display:grid; gap:8px; margin-bottom:10px; }
.cell{ height:44px; border:1px dashed rgba(148,163,184,.35); background:#fff; border-radius:8px; }

/* overlay blocks */
.lane-overlay{ position: relative; margin-top: -54px; height:44px; }
.block{ position:absolute; top:2px; bottom:2px; border:2px solid; border-radius:10px; overflow:hidden; min-width:16px; background:#fff; }
.block.over{ outline:2px dashed #ef4444; }
.block-bar{ position:absolute; left:0; top:0; bottom:0; width:6px; }
.block-text{ position:absolute; left:10px; right:6px; top:2px; bottom:2px; display:flex; align-items:center; gap:10px; font-size:.82rem; font-weight:600; color:#111827; }
.block-text .t{ min-width:86px; }
.block-text .s{ opacity:.9; }
.block-text .p{ margin-left:auto; font-weight:500; color:#334155; font-size:.78rem; }

/* chips & loader */
.nowchips{ padding: 6px 14px 12px; display:flex; gap:8px; flex-wrap:wrap; }
.chip{ padding:6px 10px; border-radius:999px; font-size:.85rem; font-weight:600; color:#1f2937; }
.chip.blue{ background:#e0f2fe; }
.chip.amber{ background:#fef3c7; }

.loader{ height:4px; margin:8px 14px 12px; background: linear-gradient(90deg, #e5e7eb, #94a3b8, #e5e7eb); background-size:200% 100%; animation: shimmer 1.2s infinite linear; border-radius:6px; }
@keyframes shimmer{ 0%{background-position:0% 0} 100%{background-position:-200% 0} }
</style>
