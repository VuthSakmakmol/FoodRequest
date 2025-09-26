<script setup>
import { ref, computed } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  form: Object,
  isTimedOrder: Boolean,
  needsOtherLocation: Boolean,
  MEALS: Array,
  r: Object
})

const eatDateMenu = ref(false)

// Hours: 01–23
const HOURS = Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0'))
// Minutes: 00, 30
const MINUTES = ['00', '30']

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

// helper: build "HH:mm"
function combineTime(hour, minute) {
  return hour && minute ? `${hour}:${minute}` : ''
}

// computed: full start/end times
const eatStartTime = computed(() => combineTime(props.form.eatStartHour, props.form.eatStartMinute))
const eatEndTime   = computed(() => combineTime(props.form.eatEndHour, props.form.eatEndMinute))

// strict check
const timeError = computed(() => {
  if (!eatStartTime.value || !eatEndTime.value) return ''
  return eatEndTime.value > eatStartTime.value ? '' : 'End time must be after start time'
})
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
          <template #activator="{ props }">
            <v-text-field
              v-bind="props"
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
          :items="['Daily meal','Meeting catering','Visitor meal']"
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
          :items="['Meeting Room','Canteen','Other']"
          label="Location"
          variant="outlined"
          density="compact"
          hide-details="auto"
        />
      </v-col>
    </v-row>

    <!-- Eat Time pickers (simplified) -->
    <v-row dense class="mt-1" v-if="isTimedOrder">
      <!-- Start time -->
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

      <!-- End time -->
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

    <!-- Show error row -->
    <v-row v-if="timeError" class="mt-1">
      <v-col cols="12">
        <span class="text-error text-caption">{{ timeError }}</span>
      </v-col>
    </v-row>

    <v-text-field
      v-if="needsOtherLocation"
      v-model="form.locationOther"
      label="Other Location"
      variant="outlined"
      density="compact"
    />

    <!-- Meals as big buttons -->
    <div class="mt-2">
      <div class="mini-title"><strong>Meal</strong></div>
      <v-row dense class="mt-1">
        <v-col cols="6" v-for="m in MEALS" :key="m">
          <v-btn
            block
            variant="tonal"
            class="choice-btn"
            style="background-color:aliceblue;"
            :value="m"
            :class="{ active: form.meals.includes(m) }"
            @click="form.meals = form.meals.includes(m) ? form.meals.filter(x => x !== m) : [...form.meals, m]"
          >
            {{ m }}
          </v-btn>
        </v-col>
      </v-row>
      <div v-if="!form.meals.length" class="text-error text-caption mt-1">
        Please select at least one meal
      </div>
    </div>

    <v-row dense class="mt-2">
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
  </v-sheet>
</template>

<style scoped>
.choice-btn {
  font-weight: 600;
  min-height: 48px;
  text-transform: none;
}
.choice-btn.active {
  background-color: #16a34a !important;
  color: white !important;
}
</style>
