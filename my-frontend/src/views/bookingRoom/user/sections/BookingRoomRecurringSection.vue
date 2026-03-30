<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'BookingRoomRecurringSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
  holidayDates: {
    type: Array,
    default: () => [],
  },
  selectedRoom: {
    type: Object,
    default: null,
  },
  maxOccurrences: {
    type: Number,
    default: 120,
  },
})

const weekDays = [
  { code: 'MON', label: 'Mon', mapKey: 'mon' },
  { code: 'TUE', label: 'Tue', mapKey: 'tue' },
  { code: 'WED', label: 'Wed', mapKey: 'wed' },
  { code: 'THU', label: 'Thu', mapKey: 'thu' },
  { code: 'FRI', label: 'Fri', mapKey: 'fri' },
  { code: 'SAT', label: 'Sat', mapKey: 'sat' },
  { code: 'SUN', label: 'Sun', mapKey: 'sun' },
]

const userTouchedEndDate = ref(false)

function s(v) {
  return String(v ?? '').trim()
}

function uniq(arr = []) {
  return [...new Set(arr)]
}

function bookingWeekDayCode(ymd) {
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return map[dayjs(ymd).day()] || 'MON'
}

function holidaySet() {
  return new Set(
    (Array.isArray(props.holidayDates) ? props.holidayDates : [])
      .map((x) => s(x))
      .filter(Boolean)
  )
}

function isHolidayOrSunday(dateStr) {
  const isSunday = dayjs(dateStr).day() === 0
  const isHoliday = holidaySet().has(s(dateStr))
  return isSunday || isHoliday
}

function roomAllowsWeekCode(code) {
  const room = props.selectedRoom
  if (!room || !room.weeklyAvailability) return true

  const found = weekDays.find((x) => x.code === code)
  if (!found) return true

  return room?.weeklyAvailability?.[found.mapKey] !== false
}

function roomAllowsDate(dateStr) {
  return roomAllowsWeekCode(bookingWeekDayCode(dateStr))
}

function firstAllowedWeekCode() {
  const found = weekDays.find((d) => roomAllowsWeekCode(d.code))
  return found?.code || ''
}

function normalizeSelectedWeekDays(list) {
  const arr = Array.isArray(list) ? list : []
  return uniq(arr.filter((code) => roomAllowsWeekCode(code)))
}

function getDefaultWeekDaysFromStart() {
  const startCode = bookingWeekDayCode(props.form.bookingDate)
  if (roomAllowsWeekCode(startCode)) return [startCode]

  const fallback = firstAllowedWeekCode()
  return fallback ? [fallback] : []
}

function setWeeklyDefaultSelection(force = false) {
  if (s(props.form.recurrenceFrequency) !== 'WEEKLY') return

  const normalized = normalizeSelectedWeekDays(props.form.recurrenceWeekDays)

  if (!force && normalized.length) {
    const same =
      normalized.length === (props.form.recurrenceWeekDays || []).length &&
      normalized.every((x, i) => x === props.form.recurrenceWeekDays[i])

    if (!same) {
      props.form.recurrenceWeekDays = normalized
    }
    return
  }

  const next = normalized.length ? normalized : getDefaultWeekDaysFromStart()
  props.form.recurrenceWeekDays = next
}

function nextSelectedWeeklyDate(startYMD, selectedCodes) {
  const start = dayjs(startYMD).startOf('day')
  const validCodes = Array.isArray(selectedCodes) ? selectedCodes : []

  for (let i = 1; i <= 14; i += 1) {
    const d = start.add(i, 'day')
    const code = bookingWeekDayCode(d.format('YYYY-MM-DD'))
    if (validCodes.includes(code)) return d.format('YYYY-MM-DD')
  }

  return start.add(7, 'day').format('YYYY-MM-DD')
}

function suggestEndDate() {
  const startYMD = s(props.form.bookingDate)
  if (!startYMD) return ''

  const start = dayjs(startYMD).startOf('day')
  const freq = s(props.form.recurrenceFrequency || 'WEEKLY')

  if (freq === 'DAILY') {
    return start.add(1, 'day').format('YYYY-MM-DD')
  }

  if (freq === 'WEEKLY') {
    const selected = normalizeSelectedWeekDays(props.form.recurrenceWeekDays)
    const picked = selected.length ? selected : getDefaultWeekDaysFromStart()
    return nextSelectedWeeklyDate(startYMD, picked)
  }

  if (freq === 'MONTHLY') {
    return start.add(1, 'month').format('YYYY-MM-DD')
  }

  if (freq === 'YEARLY') {
    return start.add(1, 'year').format('YYYY-MM-DD')
  }

  return start.add(7, 'day').format('YYYY-MM-DD')
}

function applySuggestedEndDate(force = false) {
  const suggested = suggestEndDate()
  if (!suggested) return

  const current = s(props.form.endDate)
  const start = s(props.form.bookingDate)

  if (
    force ||
    !current ||
    dayjs(current).isSame(dayjs(start), 'day') ||
    dayjs(current).isBefore(dayjs(start), 'day')
  ) {
    props.form.endDate = suggested
  }
}

function ensureRecurringDefaults() {
  if (!props.form.recurrenceFrequency) {
    props.form.recurrenceFrequency = 'WEEKLY'
  }

  props.form.recurrenceInterval = 1

  if (!Array.isArray(props.form.recurrenceWeekDays)) {
    props.form.recurrenceWeekDays = []
  }

  if (typeof props.form.skipHoliday !== 'boolean') {
    props.form.skipHoliday = true
  }

  if (s(props.form.recurrenceFrequency) === 'WEEKLY') {
    setWeeklyDefaultSelection(true)
  }

  applySuggestedEndDate(true)
}

watch(
  () => props.form.recurring,
  (on) => {
    if (!on) return
    userTouchedEndDate.value = false
    ensureRecurringDefaults()
  },
  { immediate: true }
)

watch(
  () => props.form.bookingDate,
  () => {
    if (!props.form.recurring) return

    if (s(props.form.recurrenceFrequency) === 'WEEKLY') {
      setWeeklyDefaultSelection(true)
    }

    if (!userTouchedEndDate.value) {
      applySuggestedEndDate(true)
    } else if (
      !props.form.endDate ||
      dayjs(props.form.endDate).isBefore(dayjs(props.form.bookingDate), 'day')
    ) {
      applySuggestedEndDate(true)
    }
  }
)

watch(
  () => props.form.recurrenceFrequency,
  () => {
    if (!props.form.recurring) return

    props.form.recurrenceInterval = 1

    if (s(props.form.recurrenceFrequency) === 'WEEKLY') {
      setWeeklyDefaultSelection(true)
    }

    if (!userTouchedEndDate.value) {
      applySuggestedEndDate(true)
    }
  }
)

watch(
  () => props.selectedRoom,
  () => {
    if (!props.form.recurring) return

    if (s(props.form.recurrenceFrequency) === 'WEEKLY') {
      setWeeklyDefaultSelection(true)
    }

    if (!userTouchedEndDate.value) {
      applySuggestedEndDate(true)
    }
  },
  { deep: true }
)

function toggleWeekDay(code) {
  if (!roomAllowsWeekCode(code)) return
  if (s(props.form.recurrenceFrequency) !== 'WEEKLY') return

  const current = normalizeSelectedWeekDays(props.form.recurrenceWeekDays)
  const has = current.includes(code)

  let next = has
    ? current.filter((x) => x !== code)
    : [...current, code]

  next = normalizeSelectedWeekDays(next)

  if (!next.length) {
    next = getDefaultWeekDaysFromStart()
  }

  props.form.recurrenceWeekDays = next

  if (!userTouchedEndDate.value) {
    applySuggestedEndDate(true)
  }
}

function onEndDateInput(val) {
  userTouchedEndDate.value = true
  props.form.endDate = val
}

function matchesRule(dateStr) {
  if (!props.form.recurring) return false

  const start = dayjs(props.form.bookingDate).startOf('day')
  const cur = dayjs(dateStr).startOf('day')
  const freq = s(props.form.recurrenceFrequency || 'WEEKLY')

  if (cur.isBefore(start, 'day')) return false

  if (freq === 'DAILY') {
    return true
  }

  if (freq === 'WEEKLY') {
    const picked = normalizeSelectedWeekDays(props.form.recurrenceWeekDays)
    const effectivePicked = picked.length ? picked : getDefaultWeekDaysFromStart()
    return effectivePicked.includes(bookingWeekDayCode(dateStr))
  }

  if (freq === 'MONTHLY') {
    return cur.date() === start.date()
  }

  if (freq === 'YEARLY') {
    return cur.month() === start.month() && cur.date() === start.date()
  }

  return false
}

const allDates = computed(() => {
  if (!props.form.recurring || !props.form.bookingDate || !props.form.endDate) return []

  const out = []
  let cur = dayjs(props.form.bookingDate).startOf('day')
  const end = dayjs(props.form.endDate).startOf('day')

  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    const ymd = cur.format('YYYY-MM-DD')

    if (matchesRule(ymd)) {
      out.push(ymd)
      if (out.length >= props.maxOccurrences) break
    }

    cur = cur.add(1, 'day')
  }

  return out
})

const previewDates = computed(() => {
  return allDates.value.filter((d) => {
    if (!roomAllowsDate(d)) return false
    if (props.form.skipHoliday && isHolidayOrSunday(d)) return false
    return true
  })
})

const skippedDates = computed(() => {
  return allDates.value
    .filter((d) => {
      if (!roomAllowsDate(d)) return true
      if (props.form.skipHoliday && isHolidayOrSunday(d)) return true
      return false
    })
    .map((d) => {
      if (!roomAllowsDate(d)) {
        return { date: d, reason: 'Room blocked' }
      }

      return {
        date: d,
        reason: dayjs(d).day() === 0 ? 'Sunday' : 'Holiday',
      }
    })
})

const summaryText = computed(() => {
  const freq = s(props.form.recurrenceFrequency || 'WEEKLY')

  if (freq === 'DAILY') return 'Step 2: Daily'
  if (freq === 'WEEKLY') {
    const labels = weekDays
      .filter((x) => (props.form.recurrenceWeekDays || []).includes(x.code))
      .map((x) => x.label)
      .join(', ')
    return labels ? `Step 2: Weekly on ${labels}` : 'Step 2: Weekly'
  }
  if (freq === 'MONTHLY') return 'Step 2: Monthly'
  if (freq === 'YEARLY') return 'Step 2: Yearly'
  return 'Recurring'
})
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
  >
    <header
      class="rounded-t-2xl border-b border-slate-200 bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-3 text-white dark:border-slate-700"
    >
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-center gap-3">
          <span
            class="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-white/90 text-emerald-600 text-sm shadow-sm"
          >
            <i class="fa-solid fa-rotate-right" />
          </span>

          <div>
            <h2 class="text-[11px] uppercase tracking-[0.24em] text-white/90">
              Recurring Booking
            </h2>
          </div>
        </div>

        <label
          class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-semibold"
        >
          <input
            v-model="form.recurring"
            type="checkbox"
            class="h-4 w-4 rounded border-white/40 text-emerald-500 focus:ring-emerald-400"
          />
          <span>Enable recurring booking</span>
        </label>
      </div>
    </header>

    <div class="p-3">
      <div v-if="form.recurring" class="space-y-4">
        <div class="grid gap-3 lg:grid-cols-4">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Step 1
            </div>
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Frequency
            </label>
            <select
              v-model="form.recurrenceFrequency"
              class="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Step 2
            </div>
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Start Date
            </label>
            <input
              :value="form.bookingDate"
              type="date"
              disabled
              class="mt-1 block w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-[13px] text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Start weekday auto-selects in weekly mode.
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Step 3
            </div>
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              End Date
            </label>
            <input
              :value="form.endDate"
              type="date"
              :min="form.bookingDate || undefined"
              class="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              @input="onEndDateInput($event.target.value)"
            />
            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Auto moves to the next valid recurring date.
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Step 4
            </div>
            <label class="inline-flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              <input
                v-model="form.skipHoliday"
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
              />
              <span>Skip Holiday / Sunday</span>
            </label>
            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Room blocked weekdays are always excluded automatically.
            </div>
          </div>
        </div>

        <div
          v-if="form.recurrenceFrequency === 'WEEKLY'"
          class="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <div class="flex flex-wrap items-center gap-2">
            <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Repeat On
            </div>

            <span
              class="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            >
              Auto-selected from start date
            </span>

            <span
              v-if="selectedRoom"
              class="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            >
              Red = room blocked
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label
              v-for="d in weekDays"
              :key="d.code"
              class="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold transition"
              :class="!roomAllowsWeekCode(d.code)
                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300'
                : (form.recurrenceWeekDays || []).includes(d.code)
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'"
            >
              <input
                type="checkbox"
                :checked="(form.recurrenceWeekDays || []).includes(d.code)"
                :disabled="!roomAllowsWeekCode(d.code)"
                class="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400 disabled:cursor-not-allowed"
                @change="toggleWeekDay(d.code)"
              />
              <span>{{ d.label }}</span>
            </label>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <div class="text-[12px] font-bold text-slate-700 dark:text-slate-100">
            {{ summaryText }}
          </div>
          <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {{ previewDates.length }} valid recurring date(s) will be created immediately after submit.
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Preview Dates
          </label>

          <div class="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <span
              v-for="d in previewDates"
              :key="d"
              class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
            >
              <i class="fa-solid fa-calendar-day text-[10px]" />
              {{ d }}
            </span>

            <span
              v-if="!previewDates.length"
              class="text-[11px] text-slate-500 dark:text-slate-400"
            >
              No valid recurring dates yet
            </span>
          </div>
        </div>

        <div v-if="skippedDates.length" class="space-y-2">
          <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Excluded Dates
          </label>

          <div class="flex flex-wrap gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <span
              v-for="item in skippedDates"
              :key="`${item.date}-${item.reason}`"
              class="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-300"
            >
              <i class="fa-solid fa-ban text-[10px]" />
              {{ item.date }} · {{ item.reason }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="text-[11px] text-slate-500 dark:text-slate-400">
        Tick the checkbox if you want to create recurring bookings.
      </div>
    </div>
  </section>
</template>