<!-- src/views/employee/carbooking/sections/CarBookingSchedule.vue -->
<script setup>
import { ref } from 'vue'
import dayjs from 'dayjs'
import TransportScheduleCalendar from '../calendars/TransportScheduleCalendar.vue'

const MAX_CAR = 3
const MAX_MSGR = 1
const scheduleDate = ref(dayjs().format('YYYY-MM-DD'))
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg" elevation="1">
      <v-card-text class="pa-3">
        <TransportScheduleCalendar
          v-model="scheduleDate"
          :max-car="MAX_CAR"
          :max-msgr="MAX_MSGR"
          start-hour="06"
          end-hour="22"
          :minute-step="30"
        />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.rounded-lg { border: 1px solid rgba(100,116,139,.16); }
</style>
