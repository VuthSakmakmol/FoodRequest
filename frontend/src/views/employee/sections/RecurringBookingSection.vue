<script setup>
import { ref } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  form: Object
})

const endDateMenu = ref(false)
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
</script>

<template>
  <v-sheet class="section pa-2" rounded="lg">
    <div class="hdr"><span class="n">4</span><span class="t">Recurring Booking</span></div>
    <v-row dense class="align-center">
      <v-col cols="12" sm="3">
        <v-btn-toggle v-model="form.recurring" rounded="lg" divided density="compact">
          <v-btn :value="true" size="small">Yes</v-btn>
          <v-btn :value="false" size="small">No</v-btn>
        </v-btn-toggle>
      </v-col>

      <template v-if="form.recurring">
        <v-col cols="12" sm="3">
          <v-select
            v-model="form.frequency"
            :items="['Daily','Weekly','Monthly']"
            label="Frequency"
            variant="outlined"
            density="compact"
          />
        </v-col>

        <v-col cols="12" sm="3">
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

        <v-col cols="12" sm="3">
          <v-checkbox v-model="form.skipHolidays" label="Skip holidays" density="compact" />
        </v-col>
      </template>
    </v-row>
  </v-sheet>
</template>
