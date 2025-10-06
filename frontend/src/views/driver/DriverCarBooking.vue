<!-- src/views/driver/DriverCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch      = ref('')

// headers
const headers = [
  { title: 'Time',       key: 'time',       sortable: true,  width: 140 },
  { title: 'Requester',  key: 'requester',  sortable: true,  width: 240 },
  { title: 'Itinerary',  key: 'itinerary',  sortable: false },
  { title: 'Pax',        key: 'passengers', sortable: true,  width: 70, align: 'center' },
  { title: 'Status',     key: 'status',     sortable: true,  width: 140, align: 'end' },
  { title: '',           key: 'actions',    sortable: false, width: 120, align: 'end' },
]

// Status helpers
const statusColor = s => ({
  PENDING:'grey', ACCEPTED:'primary', ON_ROAD:'info', ARRIVING:'teal',
  COMPLETED:'success', DELAYED:'warning', CANCELLED:'error'
}[s] || 'grey')
const statusIcon = s => ({
  PENDING:'mdi-timer-sand', ACCEPTED:'mdi-check-circle', ON_ROAD:'mdi-truck-fast',
  ARRIVING:'mdi-flag-checkered', COMPLETED:'mdi-check-decagram',
  DELAYED:'mdi-alert', CANCELLED:'mdi-cancel'
}[s] || 'mdi-timer-sand')

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops.map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination).join(' → ')
}

// Load list (driver scope)
async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const params = {}
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    // backend should return bookings visible to the authenticated driver (e.g., assigned or all)
    const { data } = await api.get('/driver/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || []
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load bookings'
  } finally { loading.value = false }
}

// Filters and computed items
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
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

// Socket handlers
function onCreated(doc) {
  // respect date filter if applied
  if (selectedDate.value && doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) rows.value.push({ ...doc, stops: doc.stops || [] })
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

onMounted(() => {
  try { subscribeRoleIfNeeded() } catch {}
  loadList()
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
})

watch([selectedDate, statusFilter], loadList)

// Details dialog
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }
</script>

<template>
  <v-container fluid class="pa-2">
    <v-sheet class="driver-section pa-0" rounded="lg">
      <div class="driver-header">
        <div class="hdr-left">
          <div class="hdr-title">
            <i class="fa-solid fa-clipboard-list"></i>
            <span>Car Bookings — All Status</span>
          </div>
          <div class="hdr-sub">Filter by date or status. Live updates.</div>
        </div>
        <div class="hdr-actions">
          <v-btn size="small" variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="loadList">Refresh</v-btn>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <!-- Filters -->
        <v-card flat class="soft-card mb-3">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>Filters</span>
            <v-spacer />
          </v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="selectedDate"
                  type="date"
                  label="Date (optional)"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
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
              <v-col cols="12" md="6">
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
        </v-card>

        <!-- Table -->
        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

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
                <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.tripDate }}</div>
              </template>

              <template #item.requester="{ item }">
                <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.employee?.department || '—' }} • ID {{ item.employeeId }}</div>
              </template>

              <template #item.itinerary="{ item }">
                <div class="truncate-2">{{ prettyStops(item.stops) }}</div>
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
                  <v-icon start :icon="statusIcon(item.status)" /> {{ item.status }}
                </v-chip>
              </template>

              <template #item.actions="{ item }">
                <v-btn size="small" variant="tonal" color="primary" @click.stop="showDetails(item)">
                  <v-icon start icon="mdi-information-outline" /> Details
                </v-btn>
              </template>

              <template #no-data>
                <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
                  No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
                </v-sheet>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </div>
    </v-sheet>

    <!-- Details dialog -->
    <v-dialog v-model="detailOpen" max-width="820">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-chip color="primary" size="small" label>
              <v-icon start icon="mdi-car" /> Car
            </v-chip>
            <span class="mono">{{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}</span>
          </div>
          <v-btn icon="mdi-close" variant="text" @click="detailOpen = false" />
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="6"><div class="lbl">Date</div><div class="val">{{ detailItem?.tripDate || '—' }}</div></v-col>
            <v-col cols="12" md="6"><div class="lbl">Passengers</div><div class="val">{{ detailItem?.passengers ?? 1 }}</div></v-col>

            <v-col cols="12" md="6">
              <div class="lbl">Requester</div>
              <div class="val">
                {{ detailItem?.employee?.name || '—' }}
                <div class="text-caption text-medium-emphasis">
                  {{ detailItem?.employee?.department || '—' }} • ID {{ detailItem?.employeeId }}
                </div>
              </div>
            </v-col>

            <v-col cols="12">
              <div class="lbl">Itinerary</div>
              <div class="val">
                <div v-if="(detailItem?.stops || []).length" class="stops">
                  <div v-for="(s,i) in detailItem.stops" :key="i" class="stop">
                    <v-icon size="16" :icon="s.destination === 'Airport' ? 'mdi-airplane' : 'mdi-map-marker'" class="mr-1" />
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}</span>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">Status</div>
              <div class="val">
                <v-chip :color="statusColor(detailItem?.status)" size="small" label>
                  <v-icon start :icon="statusIcon(detailItem?.status)" /> {{ detailItem?.status || '—' }}
                </v-chip>
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end"><v-btn variant="text" @click="detailOpen = false">Close</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
/* stick to the app’s 2–3 color palette via the layout */
.driver-section { border: 1px solid #e6e8ee; background:#fff; border-radius: 12px; }
.driver-header {
  display:flex; align-items:center; justify-content:space-between;
  padding: 14px 18px; background: var(--surface, #f5f7fb); border-bottom: 1px solid #e6e8ee;
}
.hdr-left { display:flex; flex-direction:column; gap:6px; }
.hdr-title { display:flex; align-items:center; gap:10px; font-weight:800; color: var(--brand, #1f2a44); }
.hdr-sub { color:#64748b; font-size:.9rem; }
.hdr-actions { display:flex; align-items:center; gap:8px; }

.soft-card { border: 1px solid #e9ecf3; border-radius: 12px; background:#fff; }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:800; color: var(--brand, #1f2a44); }

.elevated { border: 1px solid #e9ecf3; border-radius: 12px; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
</style>
