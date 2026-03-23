<script setup>
import { computed, watch } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'BookingRoomRecurringSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
  maxDays: {
    type: Number,
    default: 31,
  },
})

function s(v) {
  return String(v ?? '').trim()
}

function fmt(v) {
  return v ? dayjs(v).format('YYYY-MM-DD') : ''
}

function clampEndDate() {
  if (!props.form.bookingDate) return

  const start = dayjs(props.form.bookingDate).startOf('day')
  let end = props.form.endDate
    ? dayjs(props.form.endDate).startOf('day')
    : start.clone()

  if (!end.isValid() || end.isBefore(start)) end = start.clone()

  const maxEnd = start.add(Math.max(props.maxDays - 1, 0), 'day')
  if (end.isAfter(maxEnd)) end = maxEnd

  props.form.endDate = end.format('YYYY-MM-DD')
}

watch(
  () => props.form.recurring,
  (on) => {
    if (!on) return
    if (!props.form.endDate) props.form.endDate = props.form.bookingDate || ''
    clampEndDate()
  },
  { immediate: true }
)

watch(
  () => props.form.bookingDate,
  () => {
    if (!props.form.recurring) return
    if (!props.form.endDate) props.form.endDate = props.form.bookingDate || ''
    clampEndDate()
  }
)

watch(
  () => props.form.endDate,
  () => {
    if (!props.form.recurring) return
    clampEndDate()
  }
)

const maxEndDate = computed(() => {
  if (!props.form.bookingDate) return ''
  return dayjs(props.form.bookingDate)
    .add(Math.max(props.maxDays - 1, 0), 'day')
    .format('YYYY-MM-DD')
})

const previewDates = computed(() => {
  if (!props.form.recurring || !props.form.bookingDate || !props.form.endDate) return []

  const out = []
  let cur = dayjs(props.form.bookingDate).startOf('day')
  const end = dayjs(props.form.endDate).startOf('day')

  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    out.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }

  return out
})

const totalDays = computed(() => previewDates.value.length)
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <header
      class="flex items-center justify-between rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 px-4 py-3 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-2xl
                 bg-white/90 text-emerald-600 text-sm shadow-sm"
        >
          <i class="fa-solid fa-rotate-right" />
        </span>

        <div>
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-white/90">
            Recurring Booking
          </h2>
        </div>
      </div>

      <label class="inline-flex items-center gap-2 text-[12px] font-semibold">
        <span>{{ form.recurring ? 'On' : 'Off' }}</span>
        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition"
          :class="form.recurring ? 'bg-emerald-500' : 'bg-white/30'"
          @click="form.recurring = !form.recurring"
        >
          <span
            class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition"
            :class="form.recurring ? 'translate-x-5' : 'translate-x-1'"
          />
        </button>
      </label>
    </header>

    <div class="p-3">
      <div v-if="form.recurring" class="space-y-4">
        <div class="grid gap-3 md:grid-cols-3">
          <div class="space-y-1">
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Start Date
            </label>
            <input
              :value="fmt(form.bookingDate)"
              type="date"
              disabled
              class="block w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-[13px]
                     text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              End Date
            </label>
            <input
              v-model="form.endDate"
              type="date"
              :min="form.bookingDate || undefined"
              :max="maxEndDate || undefined"
              class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                     bg-white px-3 py-2 text-[13px]
                     text-slate-900 dark:bg-slate-900 dark:text-slate-100
                     focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Summary
            </label>
            <div
              class="flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3
                     text-[13px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {{ totalDays }} day<span v-if="totalDays !== 1">s</span> will be created
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Preview Dates
          </label>

          <div
            class="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3
                   dark:border-slate-700 dark:bg-slate-800/60"
          >
            <span
              v-for="d in previewDates"
              :key="d"
              class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5
                     text-[11px] font-semibold text-emerald-700
                     dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
            >
              <i class="fa-solid fa-calendar-day text-[10px]" />
              {{ d }}
            </span>

            <span
              v-if="!previewDates.length"
              class="text-[11px] text-slate-500 dark:text-slate-400"
            >
              No preview yet
            </span>
          </div>
        </div>
      </div>

      <div v-else class="text-[11px] text-slate-500 dark:text-slate-400">
        Turn on recurring booking to create multiple dates from the selected booking date until end date.
      </div>
    </div>
  </section>
</template>