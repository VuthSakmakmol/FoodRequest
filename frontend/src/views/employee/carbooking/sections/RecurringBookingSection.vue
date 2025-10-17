<!-- src/components/sections/RecurringTransportSection.vue -->
<script setup>
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'

/**
 * EXPECTED props.form fields (two-way bound by parent):
 *  - tripDate:    'YYYY-MM-DD'           (start date)
 *  - timeStart:   'HH:mm'                (pickup time)
 *  - recurring:   boolean
 *  - endDate:     'YYYY-MM-DD'           (user picks; repeatDays is computed)
 *  - repeatDays:  number                 (derived from tripDate..endDate inclusive)
 *  - skipHolidays:boolean
 *  - (optional) category: 'Car'|'Messenger' (not used in preview here)
 */
const props = defineProps({
  form: { type: Object, required: true },
  timezone: { type: String, default: 'Asia/Phnom_Penh' },
  defaultPickupTime: { type: String, default: '07:00' },
  maxDays: { type: Number, default: 30 },
  // Optional holiday list in 'YYYY-MM-DD'
  holidays: { type: Array, default: () => [] },
})

/* ---------- helpers ---------- */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const triggerTime = computed(() => props.form.timeStart || props.defaultPickupTime)

/* ---------- native time input ---------- */
const timeValue = computed({
  get: () => props.form.timeStart || '',
  set: (v) => {
    const [h='07', m='00'] = String(v || '').split(':')
    props.form.timeStart = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  }
})

/* ---------- YES/NO visual states ---------- */
const yesActive = computed(() => !!props.form.recurring)
const noActive  = computed(() => !props.form.recurring)

/* ---------- holiday logic (Sunday + supplied dates) ---------- */
const holidaySet = computed(() => new Set(props.holidays || []))
const isSunday   = (d) => dayjs(d).day() === 0
const isHoliday  = (d) => isSunday(d) || holidaySet.value.has(d)

/* ---------- end date source-of-truth ---------- */
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

  // If turning ON, ensure endDate exists and within maxDays
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

/* ---------- guards & syncing ---------- */
watch(
  () => props.form.recurring,
  (on) => {
    if (!on) return
    if (!props.form.tripDate) return
    if (!props.form.endDate) setEndDateAndRepeat(props.form.tripDate)
  },
  { immediate: true }
)

watch(() => props.form.tripDate, (start) => {
  if (!start) return
  if (!props.form.endDate) { setEndDateAndRepeat(start); return }
  setEndDateAndRepeat(props.form.endDate)
})

watch(() => props.form.endDate, (end) => {
  if (!end || !props.form.tripDate) return
  setEndDateAndRepeat(end)
})

/* ---------- build date list for span ---------- */
const dateItems = computed(() => {
  if (!props.form.recurring || !props.form.tripDate || !props.form.endDate) return []
  const items = []
  const start = dayjs(props.form.tripDate).startOf('day')
  const end   = dayjs(props.form.endDate).startOf('day')
  let cur = start.clone()
  // include end by adding a day to end in isBefore
  while (cur.isBefore(end.add(1,'day'), 'day')) {
    const dStr = cur.format('YYYY-MM-DD')
    const holiday   = isHoliday(dStr)
    const willCreate = props.form.skipHolidays ? !holiday : true
    items.push({
      date: dStr,
      weekday: cur.format('ddd'),
      willCreate,
      isHoliday: holiday,
      isSunday: isSunday(dStr),
      dow: cur.day(),
    })
    cur = cur.add(1, 'day')
  }
  return items
})

/* ---------- calendar 7-col (Mon-first) with responsive scroll ---------- */
const weekHeader = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
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
  const total   = dateItems.value.length
  const create  = dateItems.value.filter(x => x.willCreate).length
  const skipped = total - create
  return { total, create, skipped }
})
</script>

<template>
  <v-sheet class="section pa-3 rounded-lg">
    <div class="hdr">
      <div class="title-wrap">
        <i class="fa-solid fa-rotate-right icon-ttl"></i>
        <span class="t">Recurring Booking</span>
      </div>
    </div>

    <v-row dense class="mt-3">
      <!-- Repeat ON/OFF -->
      <v-col cols="12" md="4" lg="3">
        <div class="yesno-wrap">
          <v-btn
            size="small"
            class="yesno-btn"
            :class="form.recurring ? 'yes-on' : 'yes-off'"
            @click="setRecurring(true)"
          >
            <i class="fa-solid fa-check"></i>&nbsp; YES
          </v-btn>

          <v-btn
            size="small"
            class="yesno-btn"
            :class="!form.recurring ? 'no-on' : 'no-off'"
            @click="setRecurring(false)"
          >
            <i class="fa-solid fa-xmark"></i>&nbsp; NO
          </v-btn>
        </div>
      </v-col>

      <template v-if="form.recurring">
        <!-- Pickup Time -->
        <v-col cols="12" sm="6" md="4" lg="3">
          <div class="field-label">
            <i class="fa-solid fa-clock"></i>
            <span>Pickup Time</span>
          </div>
          <v-text-field
            v-model="timeValue"
            type="time"
            step="60"
            density="compact"
            variant="outlined"
            hide-details
            placeholder="HH:mm"
          />
          <div class="text-caption mt-1">
            Auto-create at <strong>{{ triggerTime || defaultPickupTime }}</strong> ({{ timezone }}).
          </div>
        </v-col>

        <!-- End Date -->
        <v-col cols="12" sm="6" md="4" lg="3">
          <div class="field-label">
            <i class="fa-solid fa-calendar-check"></i>
            <span>End Date</span>
          </div>

          <v-menu
            v-model="endDateMenu"
            :close-on-content-click="false"
            transition="scale-transition"
            offset-y
          >
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

        <!-- Skip holidays -->
        <v-col cols="12" md="4" lg="3">
          <div class="field-label">
            <i class="fa-solid fa-umbrella-beach"></i>
            <span>Skip holidays</span>
          </div>
          <v-switch
            v-model="form.skipHolidays"
            inset
            color="teal"
            density="compact"
            hide-details
            class="switch-compact"
            :label="form.skipHolidays ? 'Enabled' : 'Disabled'"
          />
        </v-col>

        <!-- Summary -->
        <v-col cols="12" class="pt-0">
          <div class="preview-header">
            <div class="counts">
              <span class="pill total">
                <i class="fa-solid fa-list"></i> Total: {{ counts.total }}
              </span>
              <span class="pill create">
                <i class="fa-solid fa-circle-check"></i> Will create: {{ counts.create }}
              </span>
              <span class="pill skipped" v-if="form.skipHolidays">
                <i class="fa-solid fa-ban"></i> Skipped: {{ counts.skipped }}
              </span>
            </div>
          </div>
        </v-col>

        <!-- Calendar (responsive) -->
        <v-col cols="12">
          <div class="calendar-scroll">
            <div class="week-header">
              <div v-for="w in weekHeader" :key="w" class="wkcell">{{ w }}</div>
            </div>

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
                    <template v-if="cell.willCreate">
                      <i class="fa-solid fa-circle-check"></i>
                      <span>Will create</span>
                    </template>
                    <template v-else>
                      <i class="fa-solid fa-ban"></i>
                      <span>Skipped</span>
                    </template>
                  </div>

                  <div v-if="cell.isHoliday && form.skipHolidays" class="badge-holiday">
                    Holiday
                  </div>
                  <div v-else-if="cell.isHoliday" class="badge-holiday subtle">
                    Holiday
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div v-if="!gridCells.length" class="text-caption mt-2">
            Set a <strong>Trip Date</strong> and a valid <strong>End Date</strong> to see the preview.
          </div>
        </v-col>
      </template>
    </v-row>
  </v-sheet>
</template>

<style scoped>
/* ===== Container ===== */
.section{
  background:#fff;
  border:1px solid rgba(100,116,139,.18);
  border-radius:14px;
  box-shadow:0 1px 2px rgba(0,0,0,.04), 0 4px 14px -6px rgba(16,24,40,.16);
}

/* ===== Header ===== */
.hdr{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
}
.title-wrap{ display:flex; align-items:center; gap:8px; }
.icon-ttl{ color:#0ea5a0; }
.t{ font-weight:700; font-size:1.02rem; }
.hint{ font-size:.86rem; opacity:.8; }

/* ===== Field label ===== */
.field-label{
  display:flex;
  align-items:center;
  gap:8px;
  font-weight:600;
  margin-bottom:6px;
}

/* ===== YES/NO buttons ===== */
.yesno-wrap{ display:flex; gap:8px; width:100%; }
.yesno-btn{ flex:1 1 0; font-weight:700; text-transform:none; }
.yes-on{ background:#16a34a !important; color:#fff !important; }
.yes-off{ background:#e5f7ea !important; color:#065f46 !important; }
.no-on{ background:#fca5a5 !important; color:#7f1d1d !important; }
.no-off{ background:#e5e7eb !important; color:#111827 !important; }

/* ===== Compact switch ===== */
.switch-compact :deep(.v-selection-control){ margin-block:-6px; }

/* ===== Summary pills ===== */
.preview-header{ display:flex; align-items:center; justify-content:flex-start; margin:8px 0 10px; }
.counts{ display:flex; flex-wrap:wrap; gap:8px; }
.pill{
  display:inline-flex; gap:6px; align-items:center;
  padding:6px 10px; border-radius:999px; font-size:.85rem; font-weight:600;
}
.pill.total{ background:#eef2ff; color:#3730a3; }
.pill.create{ background:#ecfdf5; color:#065f46; }
.pill.skipped{ background:#fef2f2; color:#991b1b; }

/* ===== Calendar wrapper (responsive with horizontal scroll) ===== */
.calendar-scroll{
  overflow-x:auto;
  -webkit-overflow-scrolling: touch;
  padding: 6px 12px;
}

/* Keep 7 columns readable on phones; container scrolls horizontally */
.week-header, .preview-grid{ min-width: 860px; }

/* ===== Week header (Mon..Sun) ===== */
.week-header{
  display:grid;
  grid-template-columns:repeat(7, minmax(210px, 1fr));
  gap: 14px;
  margin: 8px 0 8px;
}
.wkcell{
  text-align:center;
  font-weight:700;
  font-size:.9rem;
  opacity:.85;
}

/* ===== Calendar grid ===== */
.preview-grid{
  display:grid;
  grid-template-columns:repeat(7, minmax(210px, 1fr));
  column-gap: 14px;
  row-gap: 14px;
}

/* ===== Day cards ===== */
.preview-card{
  border:1px solid rgba(100,116,139,.18);
  border-radius:16px;
  min-height:118px;
  padding:12px 14px;
  display:flex;
  flex-direction:column;
  gap:6px;
  background:#f9fafb;
}
.preview-card.spacer{
  background:transparent;
  border-color:transparent;
  box-shadow:none;
  min-height:0;
  padding:0;
}
.preview-card.will-create{ background:#f6fffb; border-color:#bbf7d0; }
.preview-card.will-skip{ background:#fff7f7; border-color:#fecaca; }
.preview-card.is-holiday .date{ color:#dc2626; font-weight:700; }

/* ===== Card rows ===== */
.date-row, .status-row{ display:flex; align-items:center; gap:8px; }
.date-wrap{ display:flex; flex-direction:column; gap:2px; }
.en{ display:flex; align-items:center; gap:8px; font-weight:600; }
.date{ font-weight:700; }

/* ===== Badges ===== */
.sun-badge{
  background:#fee2e2; color:#b91c1c;
  border-radius:6px; padding:2px 6px; font-size:.72rem; font-weight:700;
}
.badge-holiday{
  display:inline-flex; align-self:flex-start;
  margin-top:2px; padding:2px 8px; border-radius:8px;
  font-size:.75rem; font-weight:700;
  background:#fee2e2; color:#991b1b;
}
.badge-holiday.subtle{ background:#ffe4e6; color:#9f1239; opacity:.9; }

/* ===== Small screens: compact a bit ===== */
@media (max-width: 599px){
  .section{ padding:.5rem; }
  .preview-card{ min-height:104px; }
}
</style>
