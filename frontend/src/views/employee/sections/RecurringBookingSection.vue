<!-- RecurringBooking.vue -->
<script setup>
import { ref } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  form: { type: Object, required: true } // expects {recurring, frequency, endDate, skipHolidays}
})

const endDateMenu = ref(false)
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
</script>

<template>
  <v-sheet class="section pa-2" rounded="lg">
    <div class="hdr"><span class="n"><strong>4. </strong></span><span class="t"><strong>Recurring Booking</strong></span></div>

    <v-row dense class="align-center mt-3">
      <v-col cols="12" sm="3">
        <v-btn-toggle v-model="form.recurring" rounded="lg" divided density="compact">
          <v-btn :value="true" size="small">YES</v-btn>
          <v-btn :value="false" size="small">NO</v-btn>
        </v-btn-toggle>
      </v-col>

      <template v-if="form.recurring">
        <v-col cols="12" sm="3" class="mt-6">
          <v-select
            v-model="form.frequency"
            :items="['Daily','Weekly','Monthly']"
            label="Frequency"
            variant="outlined"
            density="compact"
          />
        </v-col>

        <v-col cols="12" sm="3" class="mt-6">
          <v-menu v-model="endDateMenu" :close-on-content-click="false">
            <template #activator="{ props }">
              <v-text-field
                v-bind="props"
                :model-value="fmtDate(form.endDate)"
                label="End Date"
                variant="outlined"
                density="compact"
                readonly
              />
            </template>
            <v-date-picker v-model="form.endDate" @update:model-value="endDateMenu = false" />
          </v-menu>
        </v-col>

        <v-col cols="12" sm="3" class="d-flex align-center">
          <!-- Native checkbox -->
          <label for="skipHolidays" class="chk-wrap">
            <input
              id="skipHolidays"
              type="checkbox"
              v-model="form.skipHolidays"
              class="chk"
            />
            <span class="chk-label">Skip holidays</span>
          </label>
        </v-col>
      </template>
    </v-row>
  </v-sheet>
</template>

<style scoped>
/* bigger, high-contrast native checkbox */
.chk {
  inline-size: 22px;
  block-size: 22px;
  margin: 0 .5rem 0 0;
  accent-color: #14b8a6; /* teal-500 */
  cursor: pointer;
}
.chk:focus {
  outline: 2px solid #0ea5a0;
  outline-offset: 2px;
}
.chk-wrap {
  display: inline-flex;
  align-items: center;
  user-select: none;
  cursor: pointer;
}
.chk-label {
  font-weight: 600;
}
</style>
