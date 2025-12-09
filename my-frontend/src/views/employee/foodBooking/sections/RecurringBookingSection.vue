<!-- src/views/employee/foodrequest/sections/RecurringBookingSection.vue -->
<script setup>
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'

/**
 * EXPECTED props.form fields (two-way bound by parent):
 *  - eatDate: 'YYYY-MM-DD'
 *  - recurring: boolean
 *  - endDate: 'YYYY-MM-DD' (user picks; repeatDays is computed)
 *  - repeatDays: number (derived from eatDate..endDate inclusive)
 *  - skipHolidays: boolean
 *
 * Time (eatTimeStart / eatTimeEnd) is controlled ONLY by OrderDetailSection.
 * Recurring just reuses whatever is in the main form and does NOT change it.
 */
const props = defineProps({
  form: { type: Object, required: true },
  maxDays: { type: Number, default: 30 },
  // Optional holiday list in 'YYYY-MM-DD'
  holidays: { type: Array, default: () => [] },
})

/* ---------- helpers ---------- */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const endDateMenu = ref(false) // kept but no popup now

const daysBetweenInclusive = (startStr, endStr) => {
  const s = dayjs(startStr).startOf('day')
  const e = dayjs(endStr).startOf('day')
  const diff = e.diff(s, 'day')
  return Number.isFinite(diff) ? diff + 1 : 1
}

function clampEndDateToMax(eatDateStr, endDateStr, maxDays) {
  const minEnd = dayjs(eatDateStr).startOf('day')
  let end = dayjs(endDateStr).startOf('day')
  if (!end.isValid() || end.isBefore(minEnd)) end = minEnd
  const maxEnd = minEnd.add(Math.max(maxDays - 1, 0), 'day')
  if (end.isAfter(maxEnd)) end = maxEnd
  return end.format('YYYY-MM-DD')
}

/* ---------- recurring toggle ---------- */
function setRecurring(val) {
  if (!!props.form.recurring === val) return
  props.form.recurring = val

  if (val && props.form.eatDate) {
    const start = dayjs(props.form.eatDate).startOf('day')
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

function setEndDateAndRepeat(endDateStr) {
  if (!props.form.eatDate) return
  const clamped = clampEndDateToMax(props.form.eatDate, endDateStr, props.maxDays)
  props.form.endDate    = clamped
  props.form.repeatDays = daysBetweenInclusive(props.form.eatDate, clamped)
}

/* ---------- holiday logic (Sunday + supplied dates) ---------- */
const holidaySet = computed(() => new Set(props.holidays || []))
const isSunday   = (d) => dayjs(d).day() === 0
const isHoliday  = (d) => isSunday(d) || holidaySet.value.has(d)

/* ---------- guards & syncing ---------- */
watch(
  () => props.form.recurring,
  (on) => {
    if (!on) return
    if (!props.form.eatDate) return
    if (!props.form.endDate) setEndDateAndRepeat(props.form.eatDate)
  },
  { immediate: true }
)

watch(() => props.form.eatDate, (eat) => {
  if (!eat) return
  if (!props.form.endDate) { setEndDateAndRepeat(eat); return }
  setEndDateAndRepeat(props.form.endDate)
})

watch(() => props.form.endDate, (end) => {
  if (!end || !props.form.eatDate) return
  setEndDateAndRepeat(end)
})

/* ---------- build date list for span ---------- */
const dateItems = computed(() => {
  if (!props.form.recurring || !props.form.eatDate || !props.form.endDate) return []
  const items = []
  const start = dayjs(props.form.eatDate).startOf('day')
  const end   = dayjs(props.form.endDate).startOf('day')
  let cur = start.clone()
  while (cur.isBefore(end.add(1, 'day'), 'day')) {
    const dStr = cur.format('YYYY-MM-DD')
    const holiday    = isHoliday(dStr)
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

const maxEndDate = computed(() => {
  if (!props.form.eatDate) return undefined
  return dayjs(props.form.eatDate)
    .add(Math.max(props.maxDays - 1, 0), 'day')
    .format('YYYY-MM-DD')
})
</script>

<template>
  <!-- OUTER CARD (same pattern as Requester) -->
  <section
    class="mt-3 rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900 overflow-hidden"
  >
    <!-- Gradient header -->
    <header
      class="flex items-center justify-between
             rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
             px-4 py-3 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-2xl
                 bg-white/90 text-sky-700 text-sm shadow-sm"
        >
          <i class="fa-solid fa-rotate-right" />
        </span>
        <div class="space-y-0.5">
          <h2 class="text-sm font-semibold leading-tight">
            Recurring Order
          </h2>
          <p class="text-[11px] leading-snug text-sky-50/90">
            Repeat the same booking across multiple days, with smart holiday skipping.
          </p>
        </div>
      </div>
    </header>

    <!-- Wrapper + inner card -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-3
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="grid grid-cols-1 gap-4 md:grid-cols-12">
          <!-- Toggle -->
          <div class="md:col-span-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-slate-700 dark:text-slate-200">
                Recurring
              </span>

              <button
                type="button"
                class="inline-flex items-center rounded-full border border-slate-400/80
                       bg-slate-50/80 px-1.5 py-0.5 text-[11px]
                       text-slate-700 shadow-sm
                       dark:border-slate-600/80 dark:bg-slate-900/80 dark:text-slate-200"
                @click="setRecurring(!form.recurring)"
              >
                <span
                  class="inline-flex h-5 w-9 rounded-full transition"
                  :class="form.recurring
                    ? 'bg-emerald-400/90 justify-end'
                    : 'bg-slate-400/80 justify-start'"
                >
                  <span
                    class="m-[2px] h-4 w-4 rounded-full bg-white shadow-sm"
                  />
                </span>
                <span class="ml-1.5 font-semibold">
                  {{ form.recurring ? 'On' : 'Off' }}
                </span>
              </button>
            </div>

            <p class="text-[11px] text-slate-500 dark:text-slate-500">
              Turn this on if you want the same food request repeated over a date range.
            </p>
          </div>

          <!-- Content when recurring ON -->
          <template v-if="form.recurring">
            <!-- End date + info -->
            <div class="md:col-span-4 space-y-2">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-calendar-check text-[13px] text-emerald-500" />
                <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
                  End Date
                </h3>
              </div>

              <div class="space-y-1">
                <label
                  class="block text-[11px] font-medium text-slate-700 dark:text-slate-200"
                >
                  Repeat until
                </label>
                <input
                  v-model="form.endDate"
                  type="date"
                  :min="form.eatDate || undefined"
                  :max="maxEndDate"
                  class="block w-full rounded-xl border border-slate-400
                         bg-white px-3 py-2 text-sm text-slate-900
                         focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <p class="text-[11px] text-slate-600 dark:text-slate-400">
                From
                <strong>{{ fmtDate(form.eatDate) || '—' }}</strong>
                to
                <strong>{{ fmtDate(form.endDate) || '—' }}</strong>
                <span v-if="form.eatDate && form.endDate">
                  ({{ daysBetweenInclusive(form.eatDate, form.endDate) }} days)
                </span>
              </p>
              <p class="text-[11px] text-slate-500 dark:text-slate-500">
                Maximum {{ maxDays }} consecutive days are allowed.
              </p>
            </div>

            <!-- Skip holidays -->
            <div class="md:col-span-3 space-y-2">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-umbrella-beach text-[13px] text-amber-500" />
                <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
                  Skip Holidays
                </h3>
              </div>

              <div class="flex items-center gap-2">
                <label
                  class="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"
                >
                  <input
                    v-model="form.skipHolidays"
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-500 text-emerald-500
                           focus:ring-emerald-400
                           dark:border-slate-600"
                  />
                  <span>Skip Sundays and configured holidays.</span>
                </label>
              </div>

              <p class="text-[11px] text-slate-500 dark:text-slate-500">
                When enabled, no request will be created on Sundays and dates listed in the holiday set.
              </p>
            </div>

            <!-- Summary -->
            <div class="md:col-span-12 space-y-2">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-list-check text-[13px] text-sky-500" />
                <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
                  Summary
                </h3>
              </div>

              <div class="mt-1 flex flex-wrap gap-2">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border border-indigo-200
                         bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700
                         dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-200"
                >
                  <i class="fa-solid fa-list text-[11px]" />
                  Total days: {{ counts.total }}
                </span>

                <span
                  class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200
                         bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700
                         dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Will create: {{ counts.create }}
                </span>

                <span
                  v-if="form.skipHolidays"
                  class="inline-flex items-center gap-1.5 rounded-full border border-rose-200
                         bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-700
                         dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
                >
                  <i class="fa-solid fa-ban text-[11px]" />
                  Skipped: {{ counts.skipped }}
                </span>
              </div>
            </div>

            <!-- Calendar preview -->
            <div class="md:col-span-12 space-y-2">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-calendar-days text-[13px] text-indigo-500" />
                <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
                  Preview Calendar
                </h3>
              </div>

              <div class="mt-1 overflow-x-auto">
                <div class="min-w-[860px] space-y-2">
                  <!-- Header -->
                  <div
                    class="grid grid-cols-7 gap-3 text-[11px] font-semibold
                           text-slate-600 dark:text-slate-400"
                  >
                    <div
                      v-for="w in weekHeader"
                      :key="w"
                      class="text-center uppercase tracking-wide"
                    >
                      {{ w }}
                    </div>
                  </div>

                  <!-- Grid -->
                  <div class="grid grid-cols-7 gap-3">
                    <div
                      v-for="cell in gridCells"
                      :key="cell.key"
                      class="flex min-h-[110px] flex-col gap-2 rounded-2xl border px-3 py-2.5 text-xs
                             border-slate-400 bg-slate-50/80
                             dark:border-slate-700 dark:bg-slate-900/70"
                      :class="{
                        'opacity-0 border-none bg-transparent p-0 min-h-0': cell.isSpacer,
                        'bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-700/70':
                          !cell.isSpacer && cell.willCreate,
                        'bg-rose-50/70 border-rose-200 dark:bg-rose-950/30 dark:border-rose-700/70':
                          !cell.isSpacer && !cell.willCreate
                      }"
                    >
                      <template v-if="!cell.isSpacer">
                        <div class="flex items-center gap-2">
                          <i
                            class="fa-solid fa-calendar-day text-[11px]
                                   text-slate-500 dark:text-slate-500"
                          />
                          <div class="flex flex-col">
                            <div class="flex items-center gap-1">
                              <span class="font-semibold text-slate-800 dark:text-slate-100">
                                {{ cell.weekday }}
                              </span>
                              <span
                                v-if="cell.isSunday"
                                class="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold
                                       text-rose-700 dark:bg-rose-900/70 dark:text-rose-100"
                              >
                                Sun
                              </span>
                            </div>
                            <span class="text-[11px] text-slate-600 dark:text-slate-400">
                              {{ cell.date }}
                            </span>
                          </div>
                        </div>

                        <div class="flex items-center gap-1.5 text-[11px]">
                          <i
                            v-if="cell.willCreate"
                            class="fa-solid fa-circle-check text-emerald-500"
                          />
                          <i
                            v-else
                            class="fa-solid fa-ban text-rose-500"
                          />
                          <span
                            :class="cell.willCreate
                              ? 'text-emerald-700 dark:text-emerald-200'
                              : 'text-rose-700 dark:text-rose-200'"
                          >
                            {{ cell.willCreate ? 'Will create' : 'Skipped' }}
                          </span>
                        </div>

                        <div
                          v-if="cell.isHoliday"
                          class="mt-auto inline-flex items-center gap-1 rounded-full
                                 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700
                                 dark:bg-amber-900/60 dark:text-amber-100"
                        >
                          <i class="fa-solid fa-sun" />
                          <span>Holiday</span>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
