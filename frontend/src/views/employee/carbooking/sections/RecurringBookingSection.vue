<!-- src/views/employee/carbooking/sections/RecurringBookingSection.vue -->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'

const props = defineProps({
  form: { type: Object, required: true },
  timezone: { type: String, default: 'Asia/Phnom_Penh' },
  maxDays: { type: Number, default: 30 },
  holidays: { type: Array, default: () => [] },
})

/* ---------- helpers ---------- */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const pad2 = s => String(s ?? '').padStart(2,'0')

/* Use ONLY main form’s Start/End (no separate pickup) */
const timeStartWin = computed(() => {
  const h = props.form.startHour, m = props.form.startMinute
  return (h && m) ? `${pad2(h)}:${pad2(m)}` : ''
})
const timeEndWin = computed(() => {
  const h = props.form.endHour, m = props.form.endMinute
  return (h && m) ? `${pad2(h)}:${pad2(m)}` : ''
})

/* ---------- end date control ---------- */
const endDateMenu = ref(false)
const daysBetweenInclusive = (startStr, endStr) => {
  const s = dayjs(startStr).startOf('day')
  const e = dayjs(endStr).startOf('day')
  const diff = e.diff(s, 'day')
  return Number.isFinite(diff) ? diff + 1 : 1
}
function clampEndDateToMax(startStr, endStr, maxDays) {
  const minEnd = dayjs(startStr).startOf('day')
  let end = dayjs(endStr).startOf('day')
  if (!end.isValid() || end.isBefore(minEnd)) end = minEnd
  const maxEnd = minEnd.add(Math.max(maxDays - 1, 0), 'day')
  if (end.isAfter(maxEnd)) end = maxEnd
  return end.format('YYYY-MM-DD')
}
function setRecurring(val) {
  if (!!props.form.recurring === val) return
  props.form.recurring = val
  if (val && props.form.tripDate) {
    const start = dayjs(props.form.tripDate).startOf('day')
    const maxEnd = start.add(Math.max(props.maxDays - 1, 0), 'day')
    const curEnd = props.form.endDate ? dayjs(props.form.endDate) : start
    const end = !curEnd.isValid() || curEnd.isBefore(start) ? start
              : curEnd.isAfter(maxEnd) ? maxEnd
              : curEnd
    props.form.endDate = end.format('YYYY-MM-DD')
  }
}
function setEndDateAndRepeat(endDateStr) {
  if (!props.form.tripDate) return
  const clamped = clampEndDateToMax(props.form.tripDate, endDateStr, props.maxDays)
  props.form.endDate    = clamped
  props.form.repeatDays = daysBetweenInclusive(props.form.tripDate, clamped)
}

/* keep endDate sane whenever dates/flag change */
watch(() => props.form.recurring, (on) => {
  if (!on) return
  if (!props.form.tripDate) return
  if (!props.form.endDate) setEndDateAndRepeat(props.form.tripDate)
}, { immediate: true })
watch(() => props.form.tripDate, (start) => {
  if (!start) return
  if (!props.form.endDate) { setEndDateAndRepeat(start); return }
  setEndDateAndRepeat(props.form.endDate)
})
watch(() => props.form.endDate, (end) => {
  if (!end || !props.form.tripDate) return
  setEndDateAndRepeat(end)
})

/* ---------- server preview (holidays + Sundays) ---------- */
const serverDates   = ref([])   // will-create dates from server
const serverSkipped = ref([])   // holidays (incl. Sundays if skipHolidays=true)
const serverBusy    = ref(false)
const serverErr     = ref('')

async function fetchServerPreview() {
  serverErr.value = ''
  serverDates.value = []
  serverSkipped.value = []
  if (!props.form.recurring || !props.form.tripDate || !props.form.endDate || !timeStartWin.value) return
  try {
    serverBusy.value = true
    const { data } = await api.get('/transport/recurring/preview', {
      params: {
        start: props.form.tripDate,
        end: props.form.endDate,
        timeStart: timeStartWin.value,
        skipHolidays: String(!!props.form.skipHolidays),
      }
    })
    if (data?.ok) {
      serverDates.value = Array.isArray(data.dates) ? data.dates : []
      serverSkipped.value = Array.isArray(data.skipped) ? data.skipped : []
    } else {
      serverErr.value = data?.error || 'Preview failed'
    }
  } catch (e) {
    serverErr.value = e?.response?.data?.error || e?.message || 'Network error'
  } finally {
    serverBusy.value = false
  }
}
let debounce
function schedulePreview() { clearTimeout(debounce); debounce = setTimeout(fetchServerPreview, 300) }
onBeforeUnmount(() => clearTimeout(debounce))
watch(
  () => [props.form.recurring, props.form.tripDate, props.form.endDate, timeStartWin.value, props.form.skipHolidays],
  () => schedulePreview(),
  { immediate: true }
)

/* ---------- holiday badges ---------- */
const holidaySet = computed(() => new Set(props.holidays || []))
const isSun   = (d) => dayjs(d).day() === 0
const isHoliday  = (d) => isSun(d) || holidaySet.value.has(d) || serverSkipped.value.includes(d)

/* ---------- calendar items/grid ---------- */
const dateItems = computed(() => {
  if (!props.form.recurring || !props.form.tripDate || !props.form.endDate) return []
  const items = []
  const start = dayjs(props.form.tripDate).startOf('day')
  const end   = dayjs(props.form.endDate).startOf('day')
  let cur = start.clone()
  const serverMode = serverDates.value.length || serverSkipped.value.length
  while (cur.isBefore(end.add(1,'day'), 'day')) {
    const dStr = cur.format('YYYY-MM-DD')
    const holiday   = isHoliday(dStr)
    const willCreate = serverMode
      ? serverDates.value.includes(dStr)
      : (props.form.skipHolidays ? !holiday : true)
    items.push({
      date: dStr,
      weekday: cur.format('ddd'),
      willCreate,
      isHoliday: holiday,
      isSunday: isSun(dStr),
      dow: cur.day(),
    })
    cur = cur.add(1, 'day')
  }
  return items
})

const weekHeader = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const monFirstIndex = (dowSun0) => (dowSun0 + 6) % 7
const gridCells = computed(() => {
  if (!dateItems.value.length) return []
  const firstDowSun0 = dateItems.value[0].dow
  const lead = monFirstIndex(firstDowSun0)
  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ isSpacer: true, key: `sp-${i}` })
  for (const it of dateItems.value) cells.push({ ...it, isSpacer: false, key: it.date })
  return cells
})

const counts = computed(() => {
  if (serverDates.value.length || serverSkipped.value.length) {
    const total = serverDates.value.length + serverSkipped.value.length
    return { total, create: serverDates.value.length, skipped: serverSkipped.value.length }
  }
  const total   = dateItems.value.length
  const create  = dateItems.value.filter(x => x.willCreate).length
  const skipped = total - create
  return { total, create, skipped }
})

/* ---------- CREATE SERIES (uses main Start/End) ---------- */
function validateSeriesPayload () {
  const missing = []
  if (!props.form.tripDate) missing.push('Start date')
  if (!props.form.endDate)  missing.push('End date')
  if (!timeStartWin.value)  missing.push('Start time (main form)')
  if (!timeEndWin.value)    missing.push('End time (main form)')
  if (timeStartWin.value && timeEndWin.value && timeEndWin.value <= timeStartWin.value)
    missing.push('End time must be after Start time')

  const stops = props.form.stops || []
  if (!stops.length) missing.push('At least one destination')
  for (const s of stops) {
    if (!s.destination) missing.push('Destination is required')
    if (s.destination === 'Other' && !s.destinationOther)
      missing.push('Destination Name (Other) is required')
  }
  return missing
}

async function createSeries () {
  if (!props.form.recurring) return
  const errs = validateSeriesPayload()
  if (errs.length) {
    await Swal.fire({ icon:'warning', title:'Please fix', html: errs.map(e=>`• ${e}`).join('<br>') })
    return
  }

  const payload = {
    startDate: fmtDate(props.form.tripDate),
    endDate:   fmtDate(props.form.endDate),
    skipHolidays: !!props.form.skipHolidays,
    timeStart: timeStartWin.value,
    timeEnd:   timeEndWin.value,
    category: props.form.category || 'Car',
    passengers: Number(props.form.passengers || 1),
    customerContact: props.form.customerContact || '',
    stops: (props.form.stops || []).map(s => ({
      destination: s.destination,
      destinationOther: s.destination === 'Other' ? (s.destinationOther || '') : '',
      mapLink: s.mapLink || ''
    })),
    purpose: props.form.purpose || '',
    notes: props.form.notes || '',
    createdByEmp: {
      employeeId: props.form.employeeId || '',
      name: props.form.name || '',
      department: props.form.department || '',
      contactNumber: props.form.contactNumber || ''
    }
  }

  try {
    const { value: ok } = await Swal.fire({
      title: 'Create recurring series?',
      html: `This will create bookings for <b>${counts.value.create}</b> day(s) and skip <b>${counts.value.skipped}</b>.`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Create'
    })
    if (!ok) return

    const { data } = await api.post('/transport/recurring', payload)
    if (data?.ok) {
      await Swal.fire({
        icon:'success',
        title:'Recurring series created',
        html:`Created <b>${data.created}</b>, skipped <b>${data.skipped}</b>.`,
        timer: 1800, showConfirmButton:false
      })
    } else {
      throw new Error(data?.error || 'Create failed')
    }
  } catch (e) {
    await Swal.fire({ icon:'error', title:'Create failed', text: e?.message || 'Something went wrong.' })
  }
}
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <!-- Gradient hero -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-rotate-right"></i>
          <span>Recurring Booking</span>
        </div>
      </div>
      <!-- <div class="hero-right">
        <v-btn
          v-if="form.recurring"
          size="small"
          color="primary"
          variant="flat"
          @click="createSeries"
        >
          <i class="fa-solid fa-plus-circle mr-2"></i> Create Series
        </v-btn>
      </div> -->
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <v-card-text class="pt-2">
          <v-row dense>
            <!-- ON/OFF -->
            <v-col cols="12" md="4" lg="3">
              <div class="yesno-wrap">
                <v-btn size="small" class="yesno-btn" :class="form.recurring ? 'yes-on' : 'yes-off'" @click="setRecurring(true)">
                  <i class="fa-solid fa-check"></i>&nbsp; YES
                </v-btn>
                <v-btn size="small" class="yesno-btn" :class="!form.recurring ? 'no-on' : 'no-off'" @click="setRecurring(false)">
                  <i class="fa-solid fa-xmark"></i>&nbsp; NO
                </v-btn>
              </div>
              <div v-if="form.recurring" class="text-caption mt-2">
                <template v-if="serverBusy">Checking with server…</template>
                <template v-else-if="serverErr"><span style="color:#b91c1c">Server preview error:</span> {{ serverErr }}</template>
                <template v-else-if="serverDates.length || serverSkipped.length">In sync with server holidays (incl. Sundays).</template>
              </div>
            </v-col>

            <template v-if="form.recurring">
              <!-- End date -->
              <v-col cols="12" sm="6" md="4" lg="3">
                <v-card-title class="subhdr">
                  <i class="fa-solid fa-calendar-check"></i>
                  <span>End Date</span>
                </v-card-title>
                <v-menu v-model="endDateMenu" :close-on-content-click="false" transition="scale-transition" offset-y>
                  <template #activator="{ props: mprops }">
                    <v-text-field
                      v-bind="mprops"
                      :model-value="fmtDate(form.endDate)"
                      variant="outlined"
                      density="compact"
                      readonly
                      placeholder="YYYY-MM-DD"
                      hide-details
                      prepend-inner-icon="mdi-calendar"
                    />
                  </template>
                  <v-card>
                    <v-date-picker
                      :model-value="form.endDate || form.tripDate"
                      @update:model-value="(val) => { setEndDateAndRepeat(val); endDateMenu = false }"
                      :min="form.tripDate || undefined"
                      :max="form.tripDate ? dayjs(form.tripDate).add(Math.max(maxDays-1,0),'day').format('YYYY-MM-DD') : undefined"
                    />
                    <v-card-actions class="justify-end">
                      <v-btn variant="text" @click="endDateMenu = false">Close</v-btn>
                    </v-card-actions>
                  </v-card>
                </v-menu>

                <div class="text-caption mt-1">
                  From <strong>{{ fmtDate(form.tripDate) }}</strong>
                  to <strong>{{ fmtDate(form.endDate) }}</strong>
                  <span v-if="form.tripDate && form.endDate">
                    ({{ daysBetweenInclusive(form.tripDate, form.endDate) }} days)
                  </span>.
                </div>
              </v-col>

              <!-- Skip Holidays -->
              <v-col cols="12" md="4" lg="3">
                <v-card-title class="subhdr">
                  <i class="fa-solid fa-umbrella-beach"></i>
                  <span>Skip Holidays</span>
                </v-card-title>
                <v-switch
                  v-model="form.skipHolidays"
                  inset color="teal" density="compact"
                  hide-details class="switch-compact"
                  :label="form.skipHolidays ? 'Enabled' : 'Disabled'"
                />
              </v-col>

              <!-- Summary -->
              <v-col cols="12" class="pt-0">
                <v-card-title class="subhdr">
                  <i class="fa-solid fa-list-check"></i>
                  <span>Summary</span>
                </v-card-title>
                <div class="preview-header">
                  <div class="counts">
                    <span class="pill total"><i class="fa-solid fa-list"></i> Total: {{ counts.total }}</span>
                    <span class="pill create"><i class="fa-solid fa-circle-check"></i> Will create: {{ counts.create }}</span>
                    <span class="pill skipped" v-if="form.skipHolidays"><i class="fa-solid fa-ban"></i> Skipped: {{ counts.skipped }}</span>
                  </div>
                </div>
              </v-col>

              <!-- Calendar grid -->
              <v-col cols="12">
                <v-card-title class="subhdr">
                  <i class="fa-solid fa-calendar-days"></i>
                  <span>Preview Calendar</span>
                </v-card-title>

                <div class="calendar-scroll">
                  <div class="week-header"><div v-for="w in weekHeader" :key="w" class="wkcell">{{ w }}</div></div>
                  <div class="preview-grid">
                    <div
                      v-for="cell in gridCells"
                      :key="cell.key"
                      class="preview-card"
                      :class="{
                        spacer: cell.isSpacer,
                        'is-holiday': !cell.isSpacer && cell.isHoliday,
                        'will-create': !cell.isSpacer && cell.willCreate,
                        'will-skip': !cell.isSpacer && !cell.willCreate
                      }"
                    >
                      <template v-if="!cell.isSpacer">
                        <div class="date-row">
                          <i class="fa-solid fa-calendar-day"></i>
                          <div class="date-wrap">
                            <div class="en">
                              <span class="wk">{{ cell.weekday }}</span>
                              <span class="date">{{ cell.date }}</span>
                              <span v-if="cell.isSunday" class="sun-badge">Sun</span>
                            </div>
                          </div>
                        </div>
                        <div class="status-row">
                          <template v-if="cell.willCreate"><i class="fa-solid fa-circle-check"></i><span>Will create</span></template>
                          <template v-else><i class="fa-solid fa-ban"></i><span>Skipped</span></template>
                        </div>
                        <div v-if="cell.isHoliday && form.skipHolidays" class="badge-holiday">Holiday</div>
                        <div v-else-if="cell.isHoliday" class="badge-holiday subtle">Holiday</div>
                      </template>
                    </div>
                  </div>
                </div>

                <div v-if="!gridCells.length" class="text-caption mt-2">
                  Set a <strong>Trip Date</strong>, a valid <strong>End Date</strong>, and the main form’s <strong>Start/End</strong> time to see the preview.
                </div>
              </v-col>
            </template>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
/* —— CarBooking visual style —— */
.section { 
  background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
  border: 1px solid rgba(100,116,139,.18);
}
.hero { 
  display:flex; align-items:center; justify-content:space-between; 
  padding: 14px 18px; 
  background: linear-gradient(90deg, #5d7884 0%, #9293d4 60%, #786e95 100%); 
  color:#fff; 
}
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }
.hero-right :deep(.v-btn){ font-weight:700; }

.soft-card { border: 1px solid rgba(100,116,139,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }

.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; font-size: medium;}

/* ===== Field label (kept where used) ===== */
.field-label{ display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:6px; }

/* YES/NO buttons */
.yesno-wrap{ display:flex; gap:8px; width:100%; }
.yesno-btn{ flex:1 1 0; font-weight:700; text-transform:none; }
.yes-on{ background:#16a34a !important; color:#fff !important; }
.yes-off{ background:#ebf4ed !important; color:#9bd7c6 !important; }
.no-on{ background:#ee6161 !important; color:#a11b1b !important; }
.no-off{ background:#e5e7eb !important; color:#111827 !important; }

/* Compact switch */
.switch-compact :deep(.v-selection-control){ margin-block:-6px; }

/* Summary pills */
.preview-header{ display:flex; align-items:center; justify-content:flex-start; margin:8px 0 10px; }
.counts{ display:flex; flex-wrap:wrap; gap:8px; }
.pill{ display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px; font-size:.85rem; font-weight:600; }
.pill.total{ background:#eef2ff; color:#3730a3; }
.pill.create{ background:#ecfdf5; color:#065f46; }
.pill.skipped{ background:#fef2f2; color:#991b1b; }

/* Calendar wrapper */
.calendar-scroll{ overflow-x:auto; -webkit-overflow-scrolling: touch; padding: 6px 12px; }
.week-header, .preview-grid{ min-width: 860px; }
.week-header{ display:grid; grid-template-columns:repeat(7, minmax(210px, 1fr)); gap: 14px; margin: 8px 0 8px; }
.wkcell{ text-align:center; font-weight:700; font-size:.9rem; opacity:.85; }
.preview-grid{ display:grid; grid-template-columns:repeat(7, minmax(210px, 1fr)); column-gap: 14px; row-gap: 14px; }

/* Day cards */
.preview-card{ border:1px solid rgba(100,116,139,.18); border-radius:16px; min-height:118px; padding:12px 14px; display:flex; flex-direction:column; gap:6px; background:#f9fafb; }
.preview-card.spacer{ background:transparent; border-color:transparent; box-shadow:none; min-height:0; padding:0; }
.preview-card.will-create{ background:#f6fffb; border-color:#bbf7d0; }
.preview-card.will-skip{ background:#fff7f7; border-color:#fecaca; }
.preview-card.is-holiday .date{ color:#dc2626; font-weight:700; }

/* Card rows */
.date-row, .status-row{ display:flex; align-items:center; gap:8px; }
.date-wrap{ display:flex; flex-direction:column; gap:2px; }
.en{ display:flex; align-items:center; gap:8px; font-weight:600; }
.date{ font-weight:700; }

/* Badges */
.sun-badge{ background:#fee2e2; color:#b91c1c; border-radius:6px; padding:2px 6px; font-size:.72rem; font-weight:700; }
.badge-holiday{ display:inline-flex; align-self:flex-start; margin-top:2px; padding:2px 8px; border-radius:8px; font-size:.75rem; font-weight:700; background:#fee2e2; color:#991b1b; }
.badge-holiday.subtle{ background:#ffe4e6; color:#9f1239; opacity:.9; }

/* Small screens */
@media (max-width: 599px){
  .preview-card{ min-height:104px; }
}
</style>
