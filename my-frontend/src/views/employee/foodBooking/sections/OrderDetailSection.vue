<!-- src/views/employee/foodrequest/sections/OrderDetailSection.vue -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import { useToast } from '@/composables/useToast'

const { showToast } = useToast()

const props = defineProps({
  form: Object,
  isTimedOrder: Boolean,
  needsOtherLocation: Boolean,
  MEALS: Array,
  // route object from parent
  r: Object
})

const eatDateMenu = ref(false) // kept for compatibility, not used in template

/* Hours/Minutes */
const HOURS = Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0'))
const MINUTES = ['00', '30']

/* ───────── Meal time windows (adjust anytime) ───────── */
const MEAL_TIME_WINDOWS = {
  Breakfast: { start: '06:00', end: '09:00' },
  Lunch: { start: '11:00', end: '13:30' },
  Dinner: { start: '17:00', end: '19:30' },
  Snack: { start: '14:00', end: '16:00' }
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function hmToMinutes(h, m) {
  if (!h || !m) return null
  return toMinutes(`${h}:${m}`)
}
function inWindow(mins, w) {
  if (!w || mins == null) return false
  const a = toMinutes(w.start)
  const b = toMinutes(w.end)
  return mins >= a && mins <= b
}

/* Selected meal (Timed order => enforce single meal for clean time-zone logic) */
const selectedMeal = computed(() => {
  const arr = Array.isArray(props.form.meals) ? props.form.meals : []
  return arr.length === 1 ? arr[0] : ''
})
const mealWindow = computed(() => MEAL_TIME_WINDOWS[selectedMeal.value] || null)

const combineTime = (h, m) => (h && m ? `${h}:${m}` : '')
const eatStartTime = computed(() => combineTime(props.form.eatStartHour, props.form.eatStartMinute))
const eatEndTime = computed(() => combineTime(props.form.eatEndHour, props.form.eatEndMinute))

const timeError = computed(() => {
  // require both times if timed order + meal selected
  if (!props.isTimedOrder) return ''
  if (!selectedMeal.value) return ''
  if (!eatStartTime.value || !eatEndTime.value) return ''

  const s = hmToMinutes(props.form.eatStartHour, props.form.eatStartMinute)
  const e = hmToMinutes(props.form.eatEndHour, props.form.eatEndMinute)
  if (s == null || e == null) return ''
  if (e <= s) return 'End time must be after start time'

  // must be inside meal window
  const w = mealWindow.value
  if (w && (!inWindow(s, w) || !inWindow(e, w))) {
    return `Time must be within ${w.start}–${w.end} for ${selectedMeal.value}`
  }
  return ''
})

/* 🔒 Min eat date = today (cannot choose yesterday/past) */
const minEatDate = computed(() => dayjs().format('YYYY-MM-DD'))

/* Khmer labels for meals */
const MEAL_KM = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់'
}

/* Select data */
const ORDER_TYPES = [
  { value: 'Daily meal', title: 'Daily meal', subtitle: 'អាហារប្រចាំថ្ងៃ' },
  { value: 'Meeting catering', title: 'Meeting catering', subtitle: 'អាហារប្រជុំ' },
  { value: 'Visitor meal', title: 'Visitor meal', subtitle: 'អាហារភ្ញៀវ' }
]
const LOCATIONS = [
  { value: 'Meeting Room', title: 'Meeting Room', subtitle: 'បន្ទប់ប្រជុំ' },
  { value: 'Canteen', title: 'Canteen', subtitle: 'កង់ទីន' },
  { value: 'Other', title: 'Other', subtitle: 'ផ្សេងៗ' }
]

/* ───────── Eat date from route ?eatDate=YYYY-MM-DD + clamp to today if past ───────── */
function applyEatDateFromRoute(qDate) {
  if (!qDate) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(qDate)) return

  let d = dayjs(qDate, 'YYYY-MM-DD', true)
  if (!d.isValid()) return

  const today = dayjs().startOf('day')
  if (d.isBefore(today, 'day')) d = today
  props.form.eatDate = d.format('YYYY-MM-DD')
}

/* Clamp any manual/other changes to not go to the past */
watch(
  () => props.form.eatDate,
  (val) => {
    if (!val) return
    const todayStr = minEatDate.value
    const d = dayjs(val, 'YYYY-MM-DD', true)
    if (!d.isValid()) {
      props.form.eatDate = todayStr
      return
    }
    if (d.isBefore(dayjs(todayStr), 'day')) {
      props.form.eatDate = todayStr
    }
  }
)

/* Minutes default + initial route sync */
onMounted(() => {
  if (!props.form.eatStartMinute) props.form.eatStartMinute = '00'
  if (!props.form.eatEndMinute) props.form.eatEndMinute = '00'

  const qDate = props.r?.query?.eatDate
  applyEatDateFromRoute(qDate)
})

/* If route query changes (user clicks other date then open again in same session) */
watch(
  () => props.r?.query?.eatDate,
  (newVal) => {
    if (newVal) applyEatDateFromRoute(newVal)
  }
)

watch(() => props.form.eatStartHour, (h) => {
  if (h && !props.form.eatStartMinute) props.form.eatStartMinute = '00'
})
watch(() => props.form.eatEndHour, (h) => {
  if (h && !props.form.eatEndMinute) props.form.eatEndMinute = '00'
})

/* Show “Other Location” */
const showOtherLocation = computed(() =>
  props.needsOtherLocation || String(props.form.location || '') === 'Other'
)
watch(showOtherLocation, (visible) => {
  if (!visible) props.form.locationOther = ''
})

/* Normalize bilingual values (Daily meal - អាហារប្រចាំថ្ងៃ => Daily meal) */
function stripBilingual(v) {
  if (typeof v === 'string' && v.includes(' - ')) return v.split(' - ')[0].trim()
  return v
}
onMounted(() => {
  props.form.orderType = stripBilingual(props.form.orderType)
  props.form.location = stripBilingual(props.form.location)
})
watch(() => props.form.orderType, (v) => { props.form.orderType = stripBilingual(v) })
watch(() => props.form.location, (v) => { props.form.location = stripBilingual(v) })

/* ───────── Meal disabling by current time (cut-off rules) ───────── */
function isEatDateToday() {
  const d = props.form.eatDate
  if (!d) return false
  return dayjs(d, 'YYYY-MM-DD', true).isSame(dayjs(), 'day')
}
function nowAfter(cutoffHHmm) {
  const now = dayjs().format('HH:mm')
  return now > cutoffHHmm
}

const disableBreakfast = computed(() => isEatDateToday() && nowAfter('08:00'))
const disableLunch = computed(() => isEatDateToday() && nowAfter('10:00'))
const disableDinner = computed(() => isEatDateToday() && nowAfter('15:00'))

function isMealDisabled(m) {
  if (!isEatDateToday()) return false
  if (m === 'Breakfast') return disableBreakfast.value
  if (m === 'Lunch') return disableLunch.value
  if (m === 'Dinner') return disableDinner.value
  return false
}

/* If a meal becomes disabled while selected → auto remove from form.meals */
watch(
  [disableBreakfast, disableLunch, disableDinner, () => props.form.eatDate],
  () => {
    let updated = [...(props.form.meals || [])]
    if (disableBreakfast.value) updated = updated.filter(m => m !== 'Breakfast')
    if (disableLunch.value) updated = updated.filter(m => m !== 'Lunch')
    if (disableDinner.value) updated = updated.filter(m => m !== 'Dinner')
    props.form.meals = updated
  }
)

/* ───────── Timed order: time options are filtered by selected meal window ───────── */
const allowedHours = computed(() => {
  const w = mealWindow.value
  if (!w) return HOURS
  const out = []
  for (const h of HOURS) {
    const t00 = hmToMinutes(h, '00')
    const t30 = hmToMinutes(h, '30')
    if (inWindow(t00, w) || inWindow(t30, w)) out.push(h)
  }
  return out
})

const allowedStartMinutes = computed(() => {
  const w = mealWindow.value
  if (!w) return MINUTES
  const h = props.form.eatStartHour
  if (!h) return MINUTES.filter(m => inWindow(hmToMinutes(allowedHours.value[0] || h, m), w))
  return MINUTES.filter(m => inWindow(hmToMinutes(h, m), w))
})

const allowedEndMinutes = computed(() => {
  const w = mealWindow.value
  if (!w) return MINUTES
  const h = props.form.eatEndHour
  if (!h) return MINUTES.filter(m => inWindow(hmToMinutes(allowedHours.value[0] || h, m), w))
  return MINUTES.filter(m => inWindow(hmToMinutes(h, m), w))
})

/* When meal changes (or multiple meal selection happens), reset times to avoid invalid carryover */
watch(
  () => selectedMeal.value,
  (m) => {
    props.form.eatStartHour = ''
    props.form.eatStartMinute = '00'
    props.form.eatEndHour = ''
    props.form.eatEndMinute = '00'

    if (props.isTimedOrder && m) {
      const w = mealWindow.value
      if (w) {
        showToast({
          type: 'info',
          title: 'Eat time window',
          message: `${m} time must be within ${w.start}–${w.end}`,
          timeout: 3500
        })
      }
    }
  }
)

/* Show info ONLY when they click time (not before) */
const timeHintShown = ref(false)
function onTimeClickHint() {
  if (timeHintShown.value) return
  timeHintShown.value = true

  if (!selectedMeal.value) {
    showToast({
      type: 'info',
      title: 'Select a meal first',
      message: 'Choose a meal, then the time options will appear for that meal only.',
      timeout: 3000
    })
    return
  }

  if (isEatDateToday()) {
    const now = dayjs().format('HH:mm')
    showToast({
      type: 'info',
      title: 'Cut-off times (today)',
      message: `Current: ${now}. Breakfast cutoff 08:00, Lunch cutoff 10:00, Dinner cutoff 15:00.`,
      timeout: 4500
    })
  }
}

/* reset hint when date changes */
watch(
  () => props.form.eatDate,
  () => {
    timeHintShown.value = false
  }
)

/* Timed order: enforce single meal selection for clean time zone mapping */
function toggleMeal(m) {
  const cur = Array.isArray(props.form.meals) ? props.form.meals : []
  const has = cur.includes(m)

  if (props.isTimedOrder) {
    // disabled meal cannot be clicked (extra safety)
    if (isMealDisabled(m)) return
    props.form.meals = has ? [] : [m]
    return
  }

  // normal (non-timed): multi-select ok
  props.form.meals = has ? cur.filter(x => x !== m) : [...cur, m]
}
</script>

<template>
  <!-- OUTER CARD (same style as Requester) -->
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
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
          <i class="fa-solid fa-bowl-food" />
        </span>
        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
            Order Detail
          </h2>
        </div>
      </div>
    </header>

    <!-- INNER WRAPPER -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-3
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <!-- INNER CARD -->
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-5">
          <!-- Date & Type -->
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-calendar-day text-[13px] text-sky-500" />
              <h3 class="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100 uppercase">
                Date &amp; Type
              </h3>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <!-- Eat Date -->
              <div class="space-y-1">
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Eat Date
                </label>
                <input
                  v-model="props.form.eatDate"
                  type="date"
                  :min="minEatDate"
                  class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                         bg-white px-3 py-2 text-sm
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>

              <!-- Order Type -->
              <div class="space-y-1">
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Order Type
                </label>
                <select
                  v-model="props.form.orderType"
                  class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                         bg-white px-3 py-2 text-sm
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                >
                  <option v-for="opt in ORDER_TYPES" :key="opt.value" :value="opt.value">
                    {{ opt.title }} — {{ opt.subtitle }}
                  </option>
                </select>
              </div>
            </div>
          </section>

          <!-- Location -->
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-location-dot text-[13px] text-sky-500" />
              <h3 class="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100 uppercase">
                Location
              </h3>
            </div>

            <div class="space-y-2">
              <div class="space-y-1">
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Location
                </label>
                <select
                  v-model="props.form.location"
                  class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                         bg-white px-3 py-2 text-sm
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                >
                  <option v-for="loc in LOCATIONS" :key="loc.value" :value="loc.value">
                    {{ loc.title }} — {{ loc.subtitle }}
                  </option>
                </select>
              </div>

              <div v-if="showOtherLocation" class="space-y-1">
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Other Location
                </label>
                <input
                  v-model="props.form.locationOther"
                  type="text"
                  placeholder="e.g. Building B, Meeting Room 2, Warehouse gate…"
                  class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                         bg-white px-3 py-2 text-sm
                         text-slate-900 dark:bg-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>
          </section>

          <!-- Meals (Meal first) -->
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-utensils text-[13px] text-sky-500" />
              <h3 class="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100 uppercase">
                Meal
              </h3>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="m in MEALS"
                :key="m"
                type="button"
                :disabled="isMealDisabled(m)"
                class="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold
                       shadow-sm transition sm:text-[13px]
                       disabled:cursor-not-allowed disabled:opacity-50"
                :class="props.form.meals.includes(m)
                  ? 'border border-sky-500 bg-sky-500 text-white shadow-md'
                  : 'border border-slate-400 bg-slate-50/80 text-slate-900 hover:border-sky-500 hover:bg-sky-50/70 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-50 dark:hover:border-sky-400 dark:hover:bg-slate-800/80'"
                @click="toggleMeal(m)"
              >
                <span class="text-[13px] leading-tight">
                  {{ m }}
                </span>
                <span class="km text-[11px] opacity-80">
                  {{ MEAL_KM[m] }}
                </span>
              </button>
            </div>

            <p
              v-if="!props.form.meals.length"
              class="mt-1 text-[11px] text-red-500 dark:text-red-300"
            >
              Please select at least one meal.
            </p>

            <p
              v-if="props.isTimedOrder && props.form.meals.length > 1"
              class="mt-1 text-[11px] text-amber-600 dark:text-amber-300"
            >
              Timed order allows only 1 meal (so time options match the meal).
            </p>
          </section>

          <!-- Time (moved under Meal) -->
          <section v-if="isTimedOrder" class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-clock text-[13px] text-sky-500" />
              <h3 class="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100 uppercase">
                Eat Time
              </h3>
            </div>

            <!-- Hide time pickers until meal is selected -->
            <div v-if="!selectedMeal" class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              Select a meal first. Time options will appear for that meal only.
            </div>

            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <!-- Start -->
              <div class="space-y-1">
                <div class="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Eat Start <span class="text-slate-400">({{ mealWindow?.start }}–{{ mealWindow?.end }})</span>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <select
                    v-model="props.form.eatStartHour"
                    @focus="onTimeClickHint"
                    @click="onTimeClickHint"
                    class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                           bg-white px-2.5 py-1.5 text-sm
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  >
                    <option value="">HH</option>
                    <option v-for="h in allowedHours" :key="h" :value="h">
                      {{ h }}
                    </option>
                  </select>

                  <select
                    v-model="props.form.eatStartMinute"
                    @focus="onTimeClickHint"
                    @click="onTimeClickHint"
                    class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                           bg-white px-2.5 py-1.5 text-sm
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  >
                    <option value="">MM</option>
                    <option v-for="m in allowedStartMinutes" :key="m" :value="m">
                      {{ m }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- End -->
              <div class="space-y-1">
                <div class="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Eat End <span class="text-slate-400">({{ mealWindow?.start }}–{{ mealWindow?.end }})</span>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <select
                    v-model="props.form.eatEndHour"
                    @focus="onTimeClickHint"
                    @click="onTimeClickHint"
                    class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                           bg-white px-2.5 py-1.5 text-sm
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  >
                    <option value="">HH</option>
                    <option v-for="h in allowedHours" :key="h" :value="h">
                      {{ h }}
                    </option>
                  </select>

                  <select
                    v-model="props.form.eatEndMinute"
                    @focus="onTimeClickHint"
                    @click="onTimeClickHint"
                    class="block w-full rounded-xl border border-slate-400 dark:border-slate-600
                           bg-white px-2.5 py-1.5 text-sm
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  >
                    <option value="">MM</option>
                    <option v-for="m in allowedEndMinutes" :key="m" :value="m">
                      {{ m }}
                    </option>
                  </select>
                </div>

                <p v-if="timeError" class="mt-1 text-[11px] text-red-500 dark:text-red-300">
                  {{ timeError }}
                </p>
              </div>
            </div>
          </section>

          <!-- Quantity -->
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-people-group text-[13px] text-sky-500" />
              <h3 class="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100 uppercase">
                Quantity
              </h3>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Number of people
                </label>
                <div class="flex items-center gap-2">
                  <input
                    v-model.number="props.form.quantity"
                    type="number"
                    min="1"
                    class="block w-28 rounded-xl border border-slate-400 dark:border-slate-600
                           bg-white px-3 py-2 text-sm
                           text-slate-900 dark:bg-slate-900 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                  <span class="text-[11px] text-slate-600 dark:text-slate-400">
                    people
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.km {
  font-family: "Kantumruy Pro", system-ui, -apple-system, Segoe UI, Roboto,
    "Helvetica Neue", Arial, "Noto Sans Khmer", sans-serif;
}
</style>
