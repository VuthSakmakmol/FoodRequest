<!-- src/views/employee/carbooking/sections/TripDetailSection.vue -->
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

dayjs.extend(utc)
dayjs.extend(timezone)

const props = defineProps({
  form: { type: Object, required: true },
  CATEGORY: { type: Array, required: true },
  LOCATIONS: { type: Array, required: true },
  PASSENGER_OPTIONS: { type: Array, required: true }
})

const emit = defineEmits(['capacity-change'])
const { showToast } = useToast()

const MAX_CAR = 3
const MAX_MSGR = 1
const TIMEZONE = 'Asia/Phnom_Penh'

const availLoading = ref(false)
const availError = ref('')
const availableCar = ref(null)
const availableMsgr = ref(null)

/* ✅ only show availability AFTER user selects date + start + end */
const hasCheckedOnce = ref(false)

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

const todayPP = computed(() => dayjs().tz(TIMEZONE).format('YYYY-MM-DD'))

const startTime = computed(() =>
  props.form.startHour && props.form.startMinute
    ? `${props.form.startHour}:${props.form.startMinute}`
    : ''
)
const endTime = computed(() =>
  props.form.endHour && props.form.endMinute
    ? `${props.form.endHour}:${props.form.endMinute}`
    : ''
)

const isCarSelected = computed(() => props.form.category === 'Car')
const hasTimeSelected = computed(() => !!(props.form.tripDate && startTime.value && endTime.value))
const showAvailabilityBox = computed(() => hasTimeSelected.value && hasCheckedOnce.value)

function toMin(hhmm) {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':').map(n => parseInt(n || '0', 10))
  return (h || 0) * 60 + (m || 0)
}

/* round now up to next 30 mins in Phnom Penh */
function nextHalfHourPP() {
  const now = dayjs().tz(TIMEZONE).second(0)
  const m = now.minute()
  if (m === 0 || m === 30) return now
  if (m < 30) return now.minute(30)
  return now.add(1, 'hour').minute(0)
}

/* ✅ cannot book a past date */
function validateDate() {
  if (!props.form.tripDate) return
  if (String(props.form.tripDate) < String(todayPP.value)) {
    showToast({
      type: 'warning',
      title: 'Invalid date',
      message: 'You cannot book a past date.'
    })
    props.form.tripDate = todayPP.value
  }
}

/* ✅ cannot book late time (earlier than "now") if today */
function validateTime() {
  const now = dayjs().tz(TIMEZONE)
  const nowMin = now.hour() * 60 + now.minute()
  const isToday = props.form.tripDate === todayPP.value

  // default minutes if hour selected
  if (props.form.startHour && !props.form.startMinute) props.form.startMinute = '00'
  if (props.form.endHour && !props.form.endMinute) props.form.endMinute = '00'

  const s = toMin(`${props.form.startHour || '00'}:${props.form.startMinute || '00'}`)
  const e = toMin(`${props.form.endHour || '00'}:${props.form.endMinute || '00'}`)

  if (isToday && props.form.startHour && s < nowMin) {
    const nh = nextHalfHourPP()
    showToast({
      type: 'warning',
      title: 'Invalid start time',
      message: 'Start time cannot be earlier than current time.'
    })
    props.form.startHour = nh.hour().toString().padStart(2, '0')
    props.form.startMinute = nh.minute().toString().padStart(2, '0')
  }

  // end must be after start
  const s2 = toMin(`${props.form.startHour || '00'}:${props.form.startMinute || '00'}`)
  const e2 = toMin(`${props.form.endHour || '00'}:${props.form.endMinute || '00'}`)
  if (props.form.endHour && e2 <= s2) {
    showToast({
      type: 'warning',
      title: 'Invalid end time',
      message: 'End time must be later than start time.'
    })
    props.form.endHour = ''
    props.form.endMinute = ''
  }
}

/* ✅ availability check (instant when have date+start+end) */
async function refreshAvailability() {
  availError.value = ''
  availableCar.value = null
  availableMsgr.value = null

  if (!hasTimeSelected.value) {
    hasCheckedOnce.value = false
    emit('capacity-change', false)
    return
  }

  hasCheckedOnce.value = true
  availLoading.value = true

  try {
    const [carRes, msgrRes] = await Promise.all([
      api.get('/public/transport/checkAvailability', {
        params: {
          date: props.form.tripDate,
          start: startTime.value,
          end: endTime.value,
          category: 'Car'
        }
      }),
      api.get('/public/transport/checkAvailability', {
        params: {
          date: props.form.tripDate,
          start: startTime.value,
          end: endTime.value,
          category: 'Messenger'
        }
      })
    ])

    availableCar.value = carRes.data?.available ?? MAX_CAR
    availableMsgr.value = msgrRes.data?.available ?? MAX_MSGR

    const noneLeft = isCarSelected.value
      ? Number(availableCar.value || 0) <= 0
      : Number(availableMsgr.value || 0) <= 0

    emit('capacity-change', noneLeft)
  } catch (err) {
    availError.value =
      err?.response?.data?.message ||
      err?.message ||
      'Failed to check availability'
    emit('capacity-change', false)
  } finally {
    availLoading.value = false
  }
}

/* ✅ one watcher that enforces rules then refresh */
watch(
  () => [
    props.form.tripDate,
    props.form.category,
    props.form.startHour,
    props.form.startMinute,
    props.form.endHour,
    props.form.endMinute
  ],
  async () => {
    validateDate()
    validateTime()
    await refreshAvailability()
  },
  { immediate: true }
)

onMounted(() => {
  if (!props.form.tripDate) props.form.tripDate = todayPP.value
})
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- header -->
    <header
      class="flex items-center gap-2 rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-3 text-white"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-2xl
                 bg-white/90 text-emerald-600 text-sm shadow-sm"
        >
          <i class="fa-solid fa-clock"></i>
        </span>
        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-white/90">
            Order Details
          </h2>
        </div>
      </div>
    </header>

    <div class="bg-slate-50/60 px-3 pb-3 pt-2 dark:bg-slate-900/70">
      <!-- ✅ availability pills (hidden until date+time chosen) -->
      <div
        v-if="showAvailabilityBox"
        class="mb-3 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <div class="flex flex-wrap items-center gap-2 text-[11px]">
          <!-- car pill -->
          <span
            :class="[
              'inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold',
              availLoading
                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-100'
                : availError
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
                  : (Number(availableCar || 0) > 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200')
            ]"
          >
            <i class="fa-solid fa-car text-[10px]"></i>
            <template v-if="availLoading">Checking…</template>
            <template v-else-if="availError">Cars: error</template>
            <template v-else>Available cars: {{ availableCar ?? 0 }}</template>
          </span>

          <!-- messenger pill -->
          <span
            :class="[
              'inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold',
              availLoading
                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-100'
                : availError
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
                  : (Number(availableMsgr || 0) > 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200')
            ]"
          >
            <i class="fa-solid fa-motorcycle text-[10px]"></i>
            <template v-if="availLoading">Checking…</template>
            <template v-else-if="availError">Messenger: error</template>
            <template v-else>Available messenger: {{ availableMsgr ?? 0 }}</template>
          </span>

          <span v-if="availError" class="text-[11px] text-rose-600 dark:text-rose-300">
            {{ availError }}
          </span>
        </div>
      </div>

      <!-- schedule -->
      <div
        class="mb-3 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
          <i class="fa-solid fa-calendar-days text-[11px]"></i>
          <span>Schedule</span>
        </div>

        <div class="grid gap-3 text-xs md:grid-cols-2">
          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Category</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.category"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Select category</option>
              <option v-for="c in CATEGORY" :key="c" :value="c">
                {{ c }}
              </option>
            </select>
          </div>

          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Confirm Date</span>
              <span class="required-star">*</span>
            </label>
            <input
              v-model="props.form.tripDate"
              type="date"
              :min="todayPP"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      <!-- time & passengers -->
      <div
        class="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
          <i class="fa-solid fa-clock text-[11px]"></i>
          <span>Time &amp; Passengers</span>
        </div>

        <div class="grid gap-3 text-xs md:grid-cols-4">
          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Start Hour</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.startHour"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">HH</option>
              <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>

          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Start Minute</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.startMinute"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">MM</option>
              <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>

          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>End Hour</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.endHour"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">HH</option>
              <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>

          <div>
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>End Minute</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.endMinute"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">MM</option>
              <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
        </div>

        <div class="mt-3 grid gap-3 text-xs md:grid-cols-3">
          <div v-if="isCarSelected">
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Passengers</span>
              <span class="required-star">*</span>
            </label>
            <select
              v-model="props.form.passengers"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Select</option>
              <option value="0">0</option>
              <option v-for="p in PASSENGER_OPTIONS" :key="p" :value="p">
                {{ p }}
              </option>
            </select>
          </div>

          <div :class="isCarSelected ? 'md:col-span-2' : 'md:col-span-3'">
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Customer Contact Number</span>
            </label>
            <input
              v-model="props.form.customerContact"
              type="tel"
              class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                     text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Optional"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.required-star {
  color: #ef4444;
  font-size: 1.1em;
  margin-left: 2px;
  line-height: 1;
}
</style>
