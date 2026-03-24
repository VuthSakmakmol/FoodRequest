<script setup>
import { computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'BookingRoomDetailSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['load-availability'])

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return ((h || 0) * 60) + (m || 0)
}

function combineTime(h, m) {
  return h && m ? `${h}:${m}` : ''
}

const minBookingDate = computed(() => dayjs().format('YYYY-MM-DD'))

function clampBookingDate(val) {
  const todayStr = minBookingDate.value
  const d = dayjs(val, 'YYYY-MM-DD', true)
  if (!d.isValid()) return todayStr
  if (d.isBefore(dayjs(todayStr), 'day')) return todayStr
  return d.format('YYYY-MM-DD')
}

function triggerAvailability() {
  emit('load-availability')
}

function onBookingDateChange() {
  props.form.bookingDate = clampBookingDate(props.form.bookingDate)
  triggerAvailability()
}

watch(
  () => props.form.bookingDate,
  (val) => {
    if (!val) {
      props.form.bookingDate = minBookingDate.value
      return
    }
    const fixed = clampBookingDate(val)
    if (fixed !== val) props.form.bookingDate = fixed
  }
)

watch(
  () => props.form.timeStart,
  (val) => {
    const [h, m] = String(val || '').split(':')
    props.form.timeStartHour = h || ''
    props.form.timeStartMinute = m || '00'
  },
  { immediate: true }
)

watch(
  () => props.form.timeEnd,
  (val) => {
    const [h, m] = String(val || '').split(':')
    props.form.timeEndHour = h || ''
    props.form.timeEndMinute = m || '00'
  },
  { immediate: true }
)

watch(
  [() => props.form.timeStartHour, () => props.form.timeStartMinute],
  ([h, m]) => {
    props.form.timeStart = combineTime(h, m)
  }
)

watch(
  [() => props.form.timeEndHour, () => props.form.timeEndMinute],
  ([h, m]) => {
    props.form.timeEnd = combineTime(h, m)
  }
)

watch(() => props.form.timeStartHour, (h) => {
  if (h && !props.form.timeStartMinute) props.form.timeStartMinute = '00'
})

watch(() => props.form.timeEndHour, (h) => {
  if (h && !props.form.timeEndMinute) props.form.timeEndMinute = '00'
})

const timeError = computed(() => {
  if (!props.form.timeStart || !props.form.timeEnd) return ''
  const s = toMinutes(props.form.timeStart)
  const e = toMinutes(props.form.timeEnd)
  if (e <= s) return 'End time must be after start time.'
  return ''
})

watch(
  [() => props.form.bookingDate, () => props.form.timeStart, () => props.form.timeEnd],
  () => {
    triggerAvailability()
  }
)

onMounted(() => {
  props.form.bookingDate = clampBookingDate(props.form.bookingDate || minBookingDate.value)

  if (!props.form.timeStartMinute) props.form.timeStartMinute = '00'
  if (!props.form.timeEndMinute) props.form.timeEndMinute = '00'

  triggerAvailability()
})
</script>

<template>
  <section
    class="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <header
      class="flex items-center justify-between rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-2.5 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-7 w-7 items-center justify-center rounded-xl
                 bg-white/90 text-sky-700 text-sm shadow-sm"
        >
          <i class="fa-solid fa-calendar-check" />
        </span>

        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
            Booking Detail
          </h2>
        </div>
      </div>
    </header>

    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-2.5
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-4">
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-clipboard-list text-[12px] text-sky-500" />
              <h3
                class="text-[11px] font-semibold uppercase tracking-[0.22em]
                       text-slate-500 dark:text-slate-400"
              >
                Meeting Information
              </h3>
            </div>

            <div class="grid gap-3 xl:grid-cols-12">
              <div class="space-y-1 xl:col-span-8">
                <label class="block text-[13px] font-bold text-slate-700 dark:text-slate-200">
                  Meeting Title
                  <span class="ml-1 text-rose-500">*</span>
                </label>
                <input
                  v-model="props.form.meetingTitle"
                  type="text"
                  placeholder="Example: Weekly Production Meeting"
                  class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                         bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div class="space-y-1 xl:col-span-4">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  Note
                </label>
                <input
                  v-model="props.form.note"
                  type="text"
                  placeholder="Optional note"
                  class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                         bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          </section>

          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-clock text-[12px] text-sky-500" />
              <h3
                class="text-[11px] font-semibold uppercase tracking-[0.22em]
                       text-slate-500 dark:text-slate-400"
              >
                Date & Time
              </h3>
            </div>

            <div class="grid gap-3 xl:grid-cols-12">
              <div class="space-y-1 xl:col-span-3">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  Booking Date
                  <span class="ml-1 text-rose-500">*</span>
                </label>
                <input
                  v-model="props.form.bookingDate"
                  type="date"
                  :min="minBookingDate"
                  class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                         bg-white px-3 py-2 text-[13px]
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  @change="onBookingDateChange"
                />
              </div>

              <div class="space-y-1 xl:col-span-3">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  Start Time
                  <span class="ml-1 text-rose-500">*</span>
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <select
                    v-model="props.form.timeStartHour"
                    class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                           bg-white px-2.5 py-2 text-[13px]
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">HH</option>
                    <option v-for="h in HOURS" :key="'sh-' + h" :value="h">
                      {{ h }}
                    </option>
                  </select>

                  <select
                    v-model="props.form.timeStartMinute"
                    class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                           bg-white px-2.5 py-2 text-[13px]
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">MM</option>
                    <option v-for="m in MINUTES" :key="'sm-' + m" :value="m">
                      {{ m }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="space-y-1 xl:col-span-3">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  End Time
                  <span class="ml-1 text-rose-500">*</span>
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <select
                    v-model="props.form.timeEndHour"
                    class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                           bg-white px-2.5 py-2 text-[13px]
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">HH</option>
                    <option v-for="h in HOURS" :key="'eh-' + h" :value="h">
                      {{ h }}
                    </option>
                  </select>

                  <select
                    v-model="props.form.timeEndMinute"
                    class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                           bg-white px-2.5 py-2 text-[13px]
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">MM</option>
                    <option v-for="m in MINUTES" :key="'em-' + m" :value="m">
                      {{ m }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="space-y-1 xl:col-span-3">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  Participants
                  <span class="ml-1 text-rose-500">*</span>
                </label>
                <input
                  v-model.number="props.form.participantEstimate"
                  type="number"
                  min="1"
                  class="block w-full rounded-xl border border-slate-300 dark:border-slate-600
                         bg-white px-3 py-2 text-[13px]
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <p v-if="timeError" class="text-[11px] text-red-500 dark:text-red-300">
              {{ timeError }}
            </p>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>