<!-- OrderDetailSection.vue -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  form: Object,                 // { eatDate, orderType, location, eatStartHour, eatStartMinute, eatEndHour, eatEndMinute, meals:[], quantity, locationOther? }
  isTimedOrder: Boolean,
  needsOtherLocation: Boolean,
  MEALS: Array,                 // ['Breakfast','Lunch','Dinner','Snack']
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

/* Khmer labels for meals */
const MEAL_KM = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់'
}

/* ---- Select data (value is EN; subtitle is KM) ---- */
const ORDER_TYPES = [
  { value: 'Daily meal',      title: 'Daily meal',      subtitle: 'អាហារប្រចាំថ្ងៃ' },
  { value: 'Meeting catering',title: 'Meeting catering',subtitle: 'អាហារប្រជុំ' },
  { value: 'Visitor meal',    title: 'Visitor meal',    subtitle: 'អាហារភ្ញៀវ' }
]
const LOCATIONS = [
  { value: 'Meeting Room', title: 'Meeting Room', subtitle: 'បន្ទប់ប្រជុំ' },
  { value: 'Canteen',      title: 'Canteen',      subtitle: 'កង់ទីន' },
  { value: 'Other',        title: 'Other',        subtitle: 'ផ្សេងៗ' }
]

/* Minutes default to '00' */
onMounted(() => {
  if (!props.form.eatStartMinute) props.form.eatStartMinute = '00'
  if (!props.form.eatEndMinute)   props.form.eatEndMinute   = '00'
})

watch(() => props.form.eatStartHour, (h) => {
  if (h && !props.form.eatStartMinute) props.form.eatStartMinute = '00'
})
watch(() => props.form.eatEndHour, (h) => {
  if (h && !props.form.eatEndMinute) props.form.eatEndMinute = '00'
})

/* Show “Other Location” when value is 'Other' or forced by prop */
const showOtherLocation = computed(() =>
  props.needsOtherLocation || String(props.form.location || '') === 'Other'
)
watch(showOtherLocation, (visible) => {
  if (!visible) props.form.locationOther = ''
})

/* --- Normalize any legacy bilingual strings already in the form --- */
function stripBilingual(v) {
  // e.g. "Meeting Room - បន្ទប់ប្រជុំ" -> "Meeting Room"
  if (typeof v === 'string' && v.includes(' - ')) return v.split(' - ')[0].trim()
  return v
}
onMounted(() => {
  props.form.orderType = stripBilingual(props.form.orderType)
  props.form.location  = stripBilingual(props.form.location)
})
watch(() => props.form.orderType, (v, o) => { props.form.orderType = stripBilingual(v) })
watch(() => props.form.location,  (v, o) => { props.form.location  = stripBilingual(v) })
</script>

<template>
  <v-sheet class="section pa-2" rounded="lg">
    <div class="hdr">
      <span class="n"><strong>2</strong></span>
      <span class="t"><strong>. Order Detail</strong></span>
    </div>

    <!-- Eat Date + Order Type -->
    <v-row dense class="mt-3">
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
          <v-date-picker v-model="form.eatDate" @update:model-value="eatDateMenu = false" />
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
        />
      </v-col>
    </v-row>

    <!-- Location -->
    <v-row dense class="mt-1">
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
        />
      </v-col>
    </v-row>

    <!-- Other Location (conditional) -->
    <v-text-field
      v-if="showOtherLocation"
      v-model="form.locationOther"
      label="Other Location"
      placeholder="e.g., Building B, Lobby, Warehouse 2"
      variant="outlined"
      density="compact"
      class="mt-1"
      hide-details="auto"
    />

    <!-- Eat Time pickers -->
    <v-row dense class="mt-1" v-if="isTimedOrder">
      <!-- Start -->
      <v-col cols="12" sm="6">
        <div class="mini-title">Eat Start</div>
        <v-row dense class="mt-1">
          <v-col cols="6">
            <v-select v-model="form.eatStartHour" :items="HOURS" label="Hour" variant="outlined" density="compact" hide-details="auto" />
          </v-col>
          <v-col cols="6">
            <v-select v-model="form.eatStartMinute" :items="MINUTES" label="Minute" variant="outlined" density="compact" hide-details="auto" />
          </v-col>
        </v-row>
      </v-col>

      <!-- End -->
      <v-col cols="12" sm="6">
        <div class="mini-title">Eat End</div>
        <v-row dense class="mt-1">
          <v-col cols="6">
            <v-select v-model="form.eatEndHour" :items="HOURS" label="Hour" variant="outlined" density="compact" hide-details="auto" />
          </v-col>
          <v-col cols="6">
            <v-select v-model="form.eatEndMinute" :items="MINUTES" label="Minute" variant="outlined" density="compact" hide-details="auto" :error-messages="timeError" />
          </v-col>
        </v-row>
      </v-col>
    </v-row>

    <!-- Meals -->
    <div class="mt-2">
      <div class="mini-title"><strong>Meal</strong></div>
      <v-row dense class="mt-1">
        <v-col cols="6" v-for="m in MEALS" :key="m">
          <v-btn
            block variant="tonal" class="choice-btn two-line"
            :class="{ active: form.meals.includes(m) }"
            @click="form.meals = form.meals.includes(m) ? form.meals.filter(x => x !== m) : [...form.meals, m]"
          >
            <div class="label">
              <div class="en">{{ m }}</div>
              <div class="km">{{ MEAL_KM[m] }}</div>
            </div>
          </v-btn>
        </v-col>
      </v-row>
      <div v-if="!form.meals.length" class="text-error text-caption mt-1">Please select at least one meal</div>
    </div>

    <v-row dense class="mt-2">
      <v-col cols="12" sm="6">
        <v-text-field v-model.number="form.quantity" type="number" min="1" label="Qty" suffix="People" variant="outlined" density="compact" />
      </v-col>
    </v-row>
  </v-sheet>
</template>

<style scoped>
.choice-btn{ font-weight:600; min-height:56px; text-transform:none; background-color:aliceblue; justify-content:flex-start; text-align:left; }
.choice-btn.two-line .label{ display:flex; flex-direction:column; line-height:1.1; }
.label .en{ font-size:.98rem; }
.label .km{ font-size:.86rem; opacity:.9; margin-top:2px; }
.choice-btn.active{ background-color:#16a34a !important; color:#fff !important; }
</style>
