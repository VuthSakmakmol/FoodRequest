<!-- src/components/OrderDetailSection.vue -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  form: Object,
  isTimedOrder: Boolean,
  needsOtherLocation: Boolean,
  MEALS: Array,
  // route object from parent
  r: Object
})

const eatDateMenu = ref(false)

/* Hours/Minutes */
const HOURS = Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0'))
const MINUTES = ['00','30']

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const combineTime = (h,m) => (h && m ? `${h}:${m}` : '')

const eatStartTime = computed(() => combineTime(props.form.eatStartHour, props.form.eatStartMinute))
const eatEndTime   = computed(() => combineTime(props.form.eatEndHour, props.form.eatEndMinute))

const timeError = computed(() => {
  if (!eatStartTime.value || !eatEndTime.value) return ''
  return eatEndTime.value > eatStartTime.value ? '' : 'End time must be after start time'
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
  { value: 'Daily meal',       title: 'Daily meal',       subtitle: 'អាហារប្រចាំថ្ងៃ' },
  { value: 'Meeting catering', title: 'Meeting catering', subtitle: 'អាហារប្រជុំ' },
  { value: 'Visitor meal',     title: 'Visitor meal',     subtitle: 'អាហារភ្ញៀវ' }
]
const LOCATIONS = [
  { value: 'Meeting Room', title: 'Meeting Room', subtitle: 'បន្ទប់ប្រជុំ' },
  { value: 'Canteen',      title: 'Canteen',      subtitle: 'កង់ទីន' },
  { value: 'Other',        title: 'Other',        subtitle: 'ផ្សេងៗ' }
]

/* ───────── Eat date from route ?eatDate=YYYY-MM-DD + clamp to today if past ───────── */
function applyEatDateFromRoute(qDate) {
  if (!qDate) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(qDate)) return

  let d = dayjs(qDate, 'YYYY-MM-DD', true)
  if (!d.isValid()) return

  const today = dayjs().startOf('day')
  if (d.isBefore(today, 'day')) {
    d = today
  }
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
  if (!props.form.eatEndMinute)   props.form.eatEndMinute   = '00'

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
  props.form.location  = stripBilingual(props.form.location)
})
watch(() => props.form.orderType, (v) => { props.form.orderType = stripBilingual(v) })
watch(() => props.form.location,  (v) => { props.form.location  = stripBilingual(v) })

/* ───────── Meal disabling by current time (cut-off rules) ───────── */
/**
 * Cut-offs (only when Eat Date is TODAY):
 *  - > 08:00  → Breakfast disabled
 *  - > 10:00  → Lunch disabled
 *  - > 15:00  → Dinner disabled
 *  - Snack    → always enabled
 */
function isEatDateToday() {
  const d = props.form.eatDate
  if (!d) return false
  return dayjs(d, 'YYYY-MM-DD', true).isSame(dayjs(), 'day')
}
function nowAfter(cutoffHHmm) {
  const now = dayjs().format('HH:mm')
  return now > cutoffHHmm
}

const disableBreakfast = computed(() =>
  isEatDateToday() && nowAfter('08:00')
)
const disableLunch = computed(() =>
  isEatDateToday() && nowAfter('10:00')
)
const disableDinner = computed(() =>
  isEatDateToday() && nowAfter('15:00')
)

function isMealDisabled(m) {
  if (!isEatDateToday()) return false
  if (m === 'Breakfast') return disableBreakfast.value
  if (m === 'Lunch')     return disableLunch.value
  if (m === 'Dinner')    return disableDinner.value
  // Snack or others → always enabled
  return false
}

/* If a meal becomes disabled while selected → auto remove from form.meals */
watch(
  [disableBreakfast, disableLunch, disableDinner, () => props.form.eatDate],
  () => {
    let updated = [...(props.form.meals || [])]
    if (disableBreakfast.value) {
      updated = updated.filter(m => m !== 'Breakfast')
    }
    if (disableLunch.value) {
      updated = updated.filter(m => m !== 'Lunch')
    }
    if (disableDinner.value) {
      updated = updated.filter(m => m !== 'Dinner')
    }
    props.form.meals = updated
  }
)
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <!-- CarBooking-style gradient header -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-bowl-food"></i>
          <span>Order Detail</span>
        </div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <!-- Date & Type -->
        <v-card-title class="subhdr">
          <i class="fa-solid fa-calendar-day"></i>
          <span>Date & Type</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense class="mt-2">
            <v-col cols="12" sm="6">
              <v-menu v-model="eatDateMenu" :close-on-content-click="false">
                <template #activator="{ props: act }">
                  <v-text-field
                    v-bind="act"
                    :model-value="fmtDate(form.eatDate)"
                    label="Eat Date"
                    variant="outlined"
                    density="compact"
                    readonly
                    placeholder="YYYY-MM-DD"
                  />
                </template>
                <v-date-picker
                  v-model="form.eatDate"
                  :min="minEatDate"    
                  @update:model-value="eatDateMenu = false"
                />
              </v-menu>
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.orderType"
                :items="ORDER_TYPES"
                item-title="title"
                item-value="value"
                :item-props="it => ({ title: it.title, subtitle: it.subtitle })"
                label="Order Type"
                variant="outlined"
                density="compact"
                hide-details="auto"
              >
                <template #selection="{ item }">
                  <div class="two-line">
                    <div class="en">{{ item?.title }}</div>
                    <div class="km">{{ item?.raw?.subtitle }}</div>
                  </div>
                </template>
              </v-select>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider class="my-2" />

        <!-- Location -->
        <v-card-title class="subhdr">
          <i class="fa-solid fa-location-dot"></i>
          <span>Location</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense>
            <v-col cols="12">
              <v-select
                v-model="form.location"
                :items="LOCATIONS"
                item-title="title"
                item-value="value"
                :item-props="it => ({ title: it.title, subtitle: it.subtitle })"
                label="Location"
                variant="outlined"
                density="compact"
                hide-details="auto"
              >
                <template #selection="{ item }">
                  <div class="two-line">
                    <div class="en">{{ item?.title }}</div>
                    <div class="km">{{ item?.raw?.subtitle }}</div>
                  </div>
                </template>
              </v-select>
            </v-col>
          </v-row>

          <v-text-field
            v-if="showOtherLocation"
            v-model="form.locationOther"
            label="Other Location"
            placeholder="e.g., Building B, Lobby, Warehouse 2"
            variant="outlined"
            density="compact"
            class="mt-2"
            hide-details="auto"
          />
        </v-card-text>

        <v-divider class="my-2" />

        <!-- Time (conditional) -->
        <v-card-title v-if="isTimedOrder" class="subhdr">
          <i class="fa-solid fa-clock"></i>
          <span>Eat Time</span>
        </v-card-title>
        <v-card-text v-if="isTimedOrder" class="pt-0">
          <v-row dense class="mt-1">
            <v-col cols="12" sm="6">
              <div class="mini-title">Eat Start</div>
              <v-row dense class="mt-1">
                <v-col cols="6">
                  <v-select
                    v-model="form.eatStartHour"
                    :items="HOURS"
                    label="Hour"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                  />
                </v-col>
                <v-col cols="6">
                  <v-select
                    v-model="form.eatStartMinute"
                    :items="MINUTES"
                    label="Minute"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                  />
                </v-col>
              </v-row>
            </v-col>

            <v-col cols="12" sm="6">
              <div class="mini-title">Eat End</div>
              <v-row dense class="mt-1">
                <v-col cols="6">
                  <v-select
                    v-model="form.eatEndHour"
                    :items="HOURS"
                    label="Hour"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                  />
                </v-col>
                <v-col cols="6">
                  <v-select
                    v-model="form.eatEndMinute"
                    :items="MINUTES"
                    label="Minute"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                    :error-messages="timeError"
                  />
                </v-col>
              </v-row>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider class="my-2" />

        <!-- Meals -->
        <v-card-title class="subhdr">
          <i class="fa-solid fa-utensils"></i>
          <span>Meal</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense class="mt-1">
            <v-col cols="6" v-for="m in MEALS" :key="m">
              <v-btn
                block
                variant="tonal"
                class="choice-btn two-line"
                :class="{ active: form.meals.includes(m) }"
                :disabled="isMealDisabled(m)"
                @click="form.meals = form.meals.includes(m)
                  ? form.meals.filter(x => x !== m)
                  : [...form.meals, m]"
              >
                <div class="label mt-2">
                  <div class="en">{{ m }}</div>
                  <div class="km">{{ MEAL_KM[m] }}</div>
                </div>
              </v-btn>
            </v-col>
          </v-row>
          <div v-if="!form.meals.length" class="text-error text-caption mt-1">
            Please select at least one meal
          </div>
        </v-card-text>

        <v-divider class="my-2" />

        <!-- Quantity -->
        <v-card-title class="subhdr">
          <i class="fa-solid fa-people-group"></i>
          <span>Quantity</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense class="mt-1">
            <v-col cols="12" sm="6">
              <v-text-field
                v-model.number="form.quantity"
                type="number"
                min="1"
                label="Qty"
                suffix="People"
                variant="outlined"
                density="compact"
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
/* ——— CarBooking visual style ——— */
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

.soft-card { border: 1px solid rgba(100,116,139,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }

.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; font-size: medium; }

.km{
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}
.two-line{ display:flex; flex-direction:column; line-height:1.1; }
.two-line .km{ font-size:.86rem; opacity:.9; margin-top:2px; }

/* Choice buttons (meals) */
.choice-btn{
  font-weight:600;
  min-height:56px;
  text-transform:none;
  background-color:aliceblue;
  justify-content:flex-start;
  text-align:left;
}
.choice-btn.two-line .label{ display:flex; flex-direction:column; line-height:1.1; }
.label .en{ font-size:.98rem; }
.label .km{ font-size:.86rem; opacity:.9; margin-top:2px; }
.choice-btn.active{ background-color:#16a34a !important; color:#fff !important; }

/* Make list subtitles compact */
:deep(.v-list-item-subtitle){ line-height:1.1; }
</style>
