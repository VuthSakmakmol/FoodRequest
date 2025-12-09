<!-- src/views/employee/carbooking/sections/RecurringBookingSection.vue -->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

const props = defineProps({
  form: { type: Object, required: true },
  maxDays: { type: Number, default: 30 },
  holidays: { type: Array, default: () => [] }
})

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const pad2 = s => String(s ?? '').padStart(2, '0')

/* time window from main form */
const timeStartWin = computed(() => {
  const h = props.form.startHour
  const m = props.form.startMinute
  return (h && m) ? `${pad2(h)}:${pad2(m)}` : ''
})
const timeEndWin = computed(() => {
  const h = props.form.endHour
  const m = props.form.endMinute
  return (h && m) ? `${pad2(h)}:${pad2(m)}` : ''
})

/* day helpers */
const daysBetweenInclusive = (startStr, endStr) => {
  const s = dayjs(startStr).startOf('day')
  const e = dayjs(endStr).startOf('day')
  const diff = e.diff(s, 'day')
  return Number.isFinite(diff) ? diff + 1 : 1
}
function clampEndDateToMax (startStr, endStr, maxDays) {
  const minEnd = dayjs(startStr).startOf('day')
  let end = dayjs(endStr).startOf('day')
  if (!end.isValid() || end.isBefore(minEnd)) end = minEnd
  const maxEnd = minEnd.add(Math.max(maxDays - 1, 0), 'day')
  if (end.isAfter(maxEnd)) end = maxEnd
  return end.format('YYYY-MM-DD')
}

function setRecurring (val) {
  if (!!props.form.recurring === val) return
  props.form.recurring = val
  if (val && props.form.tripDate) {
    const start = dayjs(props.form.tripDate).startOf('day')
    const maxEnd = start.add(Math.max(props.maxDays - 1, 0), 'day')
    const curEnd = props.form.endDate ? dayjs(props.form.endDate) : start
    const end = !curEnd.isValid() || curEnd.isBefore(start)
      ? start
      : curEnd.isAfter(maxEnd)
        ? maxEnd
        : curEnd
    props.form.endDate = end.format('YYYY-MM-DD')
  }
}
function setEndDateAndRepeat (endDateStr) {
  if (!props.form.tripDate) return
  const clamped = clampEndDateToMax(props.form.tripDate, endDateStr, props.maxDays)
  props.form.endDate = clamped
  props.form.repeatDays = daysBetweenInclusive(props.form.tripDate, clamped)
}

/* keep end date in range */
watch(() => props.form.recurring, (on) => {
  if (!on || !props.form.tripDate) return
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

const maxEndAttr = computed(() =>
  props.form.tripDate
    ? dayjs(props.form.tripDate).add(Math.max(props.maxDays - 1, 0), 'day').format('YYYY-MM-DD')
    : ''
)

/* server preview */
const serverDates = ref([])
const serverSkipped = ref([])
const serverBusy = ref(false)
const serverErr = ref('')

async function fetchServerPreview () {
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
        skipHolidays: String(!!props.form.skipHolidays)
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
function schedulePreview () {
  clearTimeout(debounce)
  debounce = setTimeout(fetchServerPreview, 300)
}
onBeforeUnmount(() => clearTimeout(debounce))

watch(
  () => [props.form.recurring, props.form.tripDate, props.form.endDate, timeStartWin.value, props.form.skipHolidays],
  () => schedulePreview(),
  { immediate: true }
)

/* calendar data */
const holidaySet = computed(() => new Set(props.holidays || []))
const isSun = d => dayjs(d).day() === 0
const isHoliday = d =>
  isSun(d) || holidaySet.value.has(d) || serverSkipped.value.includes(d)

const dateItems = computed(() => {
  if (!props.form.recurring || !props.form.tripDate || !props.form.endDate) return []
  const items = []
  const start = dayjs(props.form.tripDate).startOf('day')
  const end = dayjs(props.form.endDate).startOf('day')
  let cur = start.clone()
  const serverMode = serverDates.value.length || serverSkipped.value.length

  while (cur.isBefore(end.add(1, 'day'), 'day')) {
    const dStr = cur.format('YYYY-MM-DD')
    const holiday = isHoliday(dStr)
    const willCreate = serverMode
      ? serverDates.value.includes(dStr)
      : (props.form.skipHolidays ? !holiday : true)
    items.push({
      date: dStr,
      weekday: cur.format('ddd'),
      willCreate,
      isHoliday: holiday,
      isSunday: isSun(dStr),
      dow: cur.day()
    })
    cur = cur.add(1, 'day')
  }
  return items
})

const weekHeader = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monFirstIndex = dowSun0 => (dowSun0 + 6) % 7

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
  const total = dateItems.value.length
  const create = dateItems.value.filter(x => x.willCreate).length
  const skipped = total - create
  return { total, create, skipped }
})

/* end date input handler (no TS cast) */
function onEndDateInput (e) {
  const val = e?.target?.value || ''
  setEndDateAndRepeat(val)
}
</script>

<template>
  <section
    class="mt-3 rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- hero -->
    <header
      class="flex items-center justify-between
             rounded-t-2xl border-b border-slate-200
             rounded-t-2xl
               bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
               px-4 py-3 text-white"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-2xl
                bg-white/90 text-emerald-600 text-sm shadow-sm"
        >
          <i class="fa-solid fa-rotate-right"></i>
        </span>
        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80t">
            Recure booking
          </h2>
        </div>
      </div>
    </header>

      <div
        class="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <div class="grid gap-4 text-xs text-slate-800 dark:text-slate-100 md:grid-cols-3">
          <!-- toggle -->
          <div class="space-y-2">
            <label class="flex items-center gap-3">
              <button
                type="button"
                class="relative inline-flex h-6 w-11 items-center rounded-full
                       border border-slate-300 bg-slate-200
                       transition
                       dark:border-slate-600 dark:bg-slate-800"
                @click="setRecurring(!form.recurring)"
              >
                <span
                  :class="[
                    'inline-block h-5 w-5 rounded-full bg-white shadow transform transition',
                    form.recurring ? 'translate-x-5' : 'translate-x-1'
                  ]"
                />
                <span
                  v-if="form.recurring"
                  class="pointer-events-none absolute inset-0 rounded-full bg-emerald-500/50"
                />
              </button>
              <span class="text-[12px] font-semibold">
                Recurring booking:
                <span :class="form.recurring ? 'text-emerald-600' : 'text-slate-500'">
                  {{ form.recurring ? 'On' : 'Off' }}
                </span>
              </span>
            </label>

            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              Uses the same <strong>start/end time</strong> from the main form.
            </p>

            <p v-if="form.recurring" class="text-[11px]">
              <template v-if="serverBusy">
                Checking with server…
              </template>
              <template v-else-if="serverErr">
                <span class="font-semibold text-red-700">Server preview error:</span>
                {{ serverErr }}
              </template>
              <template v-else-if="serverDates.length || serverSkipped.length">
                In sync with server holidays (including Sundays).
              </template>
            </p>
          </div>

          <!-- end date -->
          <template v-if="form.recurring">
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-[11px] font-semibold">
                <i class="fa-solid fa-calendar-check text-xs"></i>
                <span>End Date</span>
              </label>
              <input
                type="date"
                :min="form.tripDate || undefined"
                :max="maxEndAttr || undefined"
                :value="fmtDate(form.endDate)"
                @input="onEndDateInput"
                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900 outline-none
                       focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              <p class="text-[11px] text-slate-600 dark:text-slate-400">
                From <strong>{{ fmtDate(form.tripDate) || '—' }}</strong>
                to <strong>{{ fmtDate(form.endDate) || '—' }}</strong>
                <span v-if="form.tripDate && form.endDate">
                  ({{ daysBetweenInclusive(form.tripDate, form.endDate) }} days)
                </span>.
              </p>
            </div>

            <!-- skip holidays -->
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-[11px] font-semibold">
                <i class="fa-solid fa-umbrella-beach text-xs"></i>
                <span>Skip holidays</span>
              </label>
              <label class="inline-flex items-center gap-2 text-[12px]">
                <input
                  v-model="form.skipHolidays"
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>{{ form.skipHolidays ? 'Enabled — holidays will be skipped.' : 'Disabled — include holidays.' }}</span>
              </label>
            </div>
          </template>
        </div>

        <!-- summary & calendar -->
        <template v-if="form.recurring">
          <!-- summary -->
          <div class="mt-4 space-y-2">
            <div class="flex items-center gap-2 text-[11px] font-semibold">
              <i class="fa-solid fa-list-check text-xs"></i>
              <span>Summary</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700
                       dark:bg-indigo-900/40 dark:text-indigo-200"
              >
                <i class="fa-solid fa-list text-[10px]"></i> Total: {{ counts.total }}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700
                       dark:bg-emerald-900/40 dark:text-emerald-200"
              >
                <i class="fa-solid fa-circle-check text-[10px]"></i> Will create: {{ counts.create }}
              </span>
              <span
                v-if="counts.skipped > 0"
                class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700
                       dark:bg-rose-900/40 dark:text-rose-200"
              >
                <i class="fa-solid fa-ban text-[10px]"></i> Skipped: {{ counts.skipped }}
              </span>
            </div>
          </div>

          <!-- calendar preview -->
          <div class="mt-4">
            <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold">
              <i class="fa-solid fa-calendar-days text-xs"></i>
              <span>Preview calendar</span>
            </div>

            <div class="overflow-x-auto">
              <div class="min-w-[720px] space-y-2">
                <div class="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-slate-500">
                  <div v-for="w in weekHeader" :key="w">
                    {{ w }}
                  </div>
                </div>

                <div class="grid grid-cols-7 gap-2">
                  <div
                    v-for="cell in gridCells"
                    :key="cell.key"
                    :class="[
                      'min-h-[90px] rounded-xl border px-2 py-2 text-[11px]',
                      cell.isSpacer
                        ? 'border-transparent bg-transparent'
                        : cell.willCreate
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-rose-200 bg-rose-50',
                      !cell.isSpacer && cell.isHoliday ? 'ring-1 ring-rose-300' : ''
                    ]"
                  >
                    <template v-if="!cell.isSpacer">
                      <div class="flex items-center gap-2">
                        <i class="fa-solid fa-calendar-day text-[10px] text-slate-500"></i>
                        <div class="flex flex-col gap-0.5">
                          <div class="flex items-center gap-2">
                            <span class="font-semibold text-slate-700">
                              {{ cell.weekday }}
                            </span>
                            <span class="text-[10px] text-slate-500">
                              {{ cell.date }}
                            </span>
                            <span
                              v-if="cell.isSunday"
                              class="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700"
                            >
                              Sun
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="mt-2 flex items-center gap-1">
                        <i
                          :class="[
                            'text-[10px]',
                            cell.willCreate ? 'fa-solid fa-circle-check text-emerald-600' : 'fa-solid fa-ban text-rose-600'
                          ]"
                        ></i>
                        <span
                          class="font-medium"
                          :class="cell.willCreate ? 'text-emerald-700' : 'text-rose-700'"
                        >
                          {{ cell.willCreate ? 'Will create' : 'Skipped' }}
                        </span>
                      </div>

                      <div
                        v-if="cell.isHoliday"
                        class="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                      >
                        <i class="fa-solid fa-umbrella-beach text-[9px]"></i>
                        <span>Holiday</span>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <p
              v-if="!gridCells.length"
              class="mt-2 text-[11px] text-slate-500 dark:text-slate-400"
            >
              Set <strong>Trip Date</strong>, valid <strong>End Date</strong>,
              and Start/End time in the main form to see the preview.
            </p>
          </div>
        </template>
      </div>
  </section>
</template>
