<!-- src/views/admin/AdminFoodCalendar.vue -->
<script setup>
import { ref } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import api from '@/utils/api'
import dayjs from 'dayjs'

const events = ref([])
const selected = ref(null)
const dialog = ref(false)

const month = ref(dayjs().month() + 1)  // current month (1-12)
const year = ref(dayjs().year())        // current year

const months = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
]

async function loadEvents(start, end, callback) {
  // filter start = first day of month, end = last day of month
  const startDate = dayjs(`${year.value}-${month.value}-01`).startOf('month')
  const endDate = startDate.endOf('month')

  const params = new URLSearchParams()
  params.set('from', startDate.format('YYYY-MM-DD'))
  params.set('to', endDate.format('YYYY-MM-DD'))

  const { data } = await api.get(`/admin/food-requests?${params.toString()}`)
  const list = Array.isArray(data) ? data : (data?.rows || [])

  events.value = list.map(r => ({
    id: r._id,
    title: `${r.employee?.name} (${r.meals?.join(', ')}) x${r.quantity}`,
    start: dayjs(r.serveDate).format('YYYY-MM-DD'),
    color: r.status === 'CANCELED' ? '#e53935' :
           r.status === 'DELIVERED' ? '#43a047' :
           r.status === 'READY' ? '#00897b' :
           r.status === 'COOKING' ? '#fb8c00' :
           r.status === 'ACCEPTED' ? '#1e88e5' :
           '#757575',
    extendedProps: r
  }))

  callback(events.value)
}

const calendarOptions = ref({
  plugins: [dayGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  events: (fetchInfo, success) => loadEvents(fetchInfo.start, fetchInfo.end, success),
  eventClick: (info) => {
    selected.value = info.event.extendedProps
    dialog.value = true
  }
})

const fmtDate = (d) => d ? dayjs(d).format('YYYY-MM-DD') : '—'
const COLOR = { NEW:'grey', ACCEPTED:'blue', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }

function applyFilter() {
  // reload calendar with new month/year filter
  const calendarApi = document.querySelector('.fc').__fullCalendar
  if (calendarApi) {
    calendarApi.gotoDate(dayjs(`${year.value}-${month.value}-01`).toDate())
  }
}
</script>

<template>
  <v-container fluid>
    <v-card elevation="2" class="rounded-lg pa-2">
      <!-- Toolbar -->
      <v-toolbar flat density="comfortable">
        <v-toolbar-title class="font-weight-bold">📅 Food Request Calendar</v-toolbar-title>
        <v-spacer />
        <v-select
          v-model="month"
          :items="months"
          item-title="label"
          item-value="value"
          density="compact"
          variant="outlined"
          label="Month"
          hide-details
          class="mr-2"
          style="max-width: 150px"
        />
        <v-text-field
          v-model="year"
          type="number"
          density="compact"
          variant="outlined"
          label="Year"
          hide-details
          class="mr-2"
          style="max-width: 120px"
        />
        <v-btn color="primary" @click="applyFilter">Apply</v-btn>
      </v-toolbar>

      <v-divider />

      <!-- Calendar -->
      <FullCalendar :options="calendarOptions" style="height: 80vh;" />
    </v-card>

    <!-- Dialog -->
    <v-dialog v-model="dialog" max-width="650px">
      <v-card v-if="selected" class="rounded-xl">
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2" color="primary">mdi-silverware-fork-knife</v-icon>
          <span class="text-h6">Food Request — {{ selected.requestId }}</span>
          <v-spacer />
          <v-chip :color="COLOR[selected.status]" size="small" label>{{ selected.status }}</v-chip>
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <p><b> Employee:</b><br>{{ selected.employee?.employeeId }} — {{ selected.employee?.name }} ({{ selected.employee?.department }})</p>
              <p><b> Serve Date:</b><br>{{ fmtDate(selected.serveDate) }}</p>
              <p><b> Order Type:</b><br>{{ selected.orderType }}</p>
              <p><b> Meals:</b><br>{{ (selected.meals || []).join(', ') }}</p>
              <p><b> Quantity:</b> {{ selected.quantity }}</p>
            </v-col>
            <v-col cols="12" md="6">
              <p><b> Location:</b><br>{{ selected.location?.kind }}<span v-if="selected.location?.other"> — {{ selected.location.other }}</span></p>
              <p><b> Menu:</b> {{ selected.menuType }}</p>
              <p><b> Cancel Reason:</b> {{ selected.cancelReason || '—' }}</p>
              <p><b> Note:</b> {{ selected.specialInstructions || '—' }}</p>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />

        <v-card-actions>
          <v-spacer />
          <v-btn text color="primary" @click="dialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style>
.fc { 
  --fc-border-color: #ddd;
  --fc-daygrid-event-dot-width: 10px;
}
</style>
