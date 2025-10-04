<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch = ref('')

const meId = ref(localStorage.getItem('employeeId') || '')

const headers = [
  { title: 'Time',          key: 'time',         sortable: true,  width: 140 },
  { title: 'Category',      key: 'category',     sortable: true,  width: 120 },
  { title: 'Requester',     key: 'requester',    sortable: true,  width: 220 },
  { title: 'Itinerary',     key: 'itinerary',    sortable: false },
  { title: 'Pax',           key: 'passengers',   sortable: true,  width: 70, align: 'center' },
  { title: 'Status',        key: 'status',       sortable: true,  width: 150, align: 'end' }
]

// load all bookings for the chosen day
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = { date: selectedDate.value }
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    const { data } = await api.get('/admin/car-bookings', { params }) // helper adds /api
    // normalize
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      isMine: meId.value && String(x.employeeId) === String(meId.value),
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
  } finally {
    loading.value = false
  }
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops.map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination).join(' → ')
}

const statusColor = s => ({
  PENDING:'grey',
  ACCEPTED:'primary',
  ON_ROAD:'info',
  ARRIVING:'teal',
  COMPLETED:'success',
  DELAYED:'warning',
  CANCELLED:'error'
}[s] || 'grey')

const statusIcon = s => ({
  PENDING:'mdi-timer-sand',
  ACCEPTED:'mdi-check-circle',
  ON_ROAD:'mdi-truck-fast',
  ARRIVING:'mdi-flag-checkered',
  COMPLETED:'mdi-check-decagram',
  DELAYED:'mdi-alert',
  CANCELLED:'mdi-cancel'
}[s] || 'mdi-timer-sand')

const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name, r.employee?.department, r.employeeId,
        r.purpose, r.notes, prettyStops(r.stops)
      ].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

function openTicket(url){ if (url) window.open(url, '_blank', 'noopener,noreferrer') }

/* Live updates: if the created/updated booking is on the selected date, reflect it */
function onCreated(doc) {
  if (!doc?.tripDate || doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) {
    rows.value.push({
      ...doc,
      isMine: meId.value && String(doc.employeeId) === String(meId.value),
      stops: doc.stops || []
    })
  }
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

onMounted(() => {
  loadSchedule()
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
})

// when date/status/category changes → reload
watch([selectedDate, statusFilter], loadSchedule)
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg slim-card" elevation="1">
      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          Day Schedule — All Requests
        </v-toolbar-title>
        <v-spacer />
        <div class="legend d-none d-md-flex">
          <v-chip size="small" color="primary" label class="mr-1">Mine</v-chip>
          <v-chip size="small" label class="mr-1">Others</v-chip>
        </div>
        <v-btn size="small" variant="text" @click="loadSchedule" :loading="loading" prepend-icon="mdi-refresh">Refresh</v-btn>
      </v-toolbar>

      <v-divider />

      <v-card-text class="pt-3 pb-0">
        <v-row dense>
          <v-col cols="12" md="3">
            <v-text-field
              v-model="selectedDate"
              type="date"
              label="Date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="6" md="3">
            <v-select
              :items="['ALL','PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']"
              v-model="statusFilter"
              label="Status"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="6" md="3">
            <v-select
              :items="['ALL','Car','Messenger']"
              v-model="categoryFilter"
              label="Category"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-text-field
              v-model="qSearch"
              label="Search requester / purpose / destination"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              hide-details
              clearable
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">
          {{ error }}
        </v-alert>

        <v-data-table
          :headers="headers"
          :items="filtered"
          :loading="loading"
          item-key="_id"
          density="comfortable"
          class="elevated"
        >
          <template #loading>
            <v-skeleton-loader type="table-row@6" />
          </template>

          <template #item.time="{ item }">
            <div class="mono">
              {{ item.timeStart }} – {{ item.timeEnd }}
            </div>
          </template>

          <template #item.category="{ item }">
            <v-chip :color="item.category === 'Car' ? 'primary' : 'orange'" size="small" label>
              <v-icon start :icon="item.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'" />
              {{ item.category }}
            </v-chip>
          </template>

          <template #item.requester="{ item }">
            <div class="d-flex align-center">
              <v-chip v-if="item.isMine" size="x-small" color="primary" variant="elevated" class="mr-2">Mine</v-chip>
              <div>
                <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                </div>
              </div>
            </div>
          </template>

          <template #item.itinerary="{ item }">
            <div class="truncate-2">
              {{ prettyStops(item.stops) }}
              <v-btn
                v-if="item.ticketUrl"
                size="x-small"
                color="indigo"
                variant="tonal"
                class="ml-2"
                @click="openTicket(item.ticketUrl)"
              >
                <v-icon start icon="mdi-paperclip" /> Ticket
              </v-btn>
            </div>
            <div class="text-caption mt-1" v-if="item.purpose || item.notes">
              <span class="text-medium-emphasis">Purpose:</span> {{ item.purpose || '—' }}
              <span v-if="item.notes"> • <span class="text-medium-emphasis">Notes:</span> {{ item.notes }}</span>
            </div>
          </template>

          <template #item.passengers="{ item }">
            <div class="text-center">{{ item.passengers ?? 1 }}</div>
          </template>

          <template #item.status="{ item }">
            <v-chip :color="statusColor(item.status)" size="small" label>
              <v-icon start :icon="statusIcon(item.status)" />
              {{ item.status }}
            </v-chip>
          </template>

          <template #no-data>
            <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
              No bookings on {{ selectedDate }}.
            </v-sheet>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card { border: 1px solid rgba(100,116,139,.16); }
.slim-toolbar { background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.elevated { border: 1px solid rgba(100,116,139,.14); border-radius: 12px; }
.legend .v-chip { border: 1px solid rgba(100,116,139,.2); }
.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
