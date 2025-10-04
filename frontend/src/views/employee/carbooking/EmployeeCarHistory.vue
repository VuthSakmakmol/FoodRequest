<!-- src/employee/carbooking/EmployeeCarHistory.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate   = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter   = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch        = ref('')

const meId = ref(localStorage.getItem('employeeId') || '')

/* ——— Build absolute URL to API origin for /uploads links ——— */
const API_ORIGIN = (api.defaults.baseURL || '')
  .replace(/\/api\/?$/,'')
  .replace(/\/$/,'')
function absUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`
}
function openTicket(u){
  const url = absUrl(u)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

/* ——— Data table headers ——— */
const headers = [
  { title: 'Time',        key: 'time',       sortable: true,  width: 140 },
  { title: 'Category',    key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',   key: 'requester',  sortable: true,  width: 220 },
  { title: 'Itinerary',   key: 'itinerary',  sortable: false },
  { title: 'Pax',         key: 'passengers', sortable: true,  width: 70, align: 'center' },
  { title: 'Status',      key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: '',            key: 'actions',    sortable: false, width: 120, align: 'end' }
]

/* ——— Load schedule ——— */
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = { date: selectedDate.value }
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      isMine: meId.value && String(x.employeeId) === String(meId.value),
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
  } finally { loading.value = false }
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops.map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination).join(' → ')
}

const statusColor = s => ({
  PENDING:'grey', ACCEPTED:'primary', ON_ROAD:'info', ARRIVING:'teal',
  COMPLETED:'success', DELAYED:'warning', CANCELLED:'error'
}[s] || 'grey')
const statusIcon = s => ({
  PENDING:'mdi-timer-sand', ACCEPTED:'mdi-check-circle', ON_ROAD:'mdi-truck-fast',
  ARRIVING:'mdi-flag-checkered', COMPLETED:'mdi-check-decagram',
  DELAYED:'mdi-alert', CANCELLED:'mdi-cancel'
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

watch([selectedDate, statusFilter], loadSchedule)

/* ——— Details dialog ——— */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }
function onRowClick(_e, ctx){ const data = ctx?.item?.raw || ctx?.item || ctx; if (data) showDetails(data) }
</script>

<template>
  <v-container fluid class="pa-2">
    <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
      <div class="hero">
        <div class="hero-left">
          <div class="hero-title">
            <i class="fa-solid fa-calendar-check"></i>
            <span>Day Schedule — All Requests</span>
          </div>
          <div class="hero-sub">Browse all bookings for a selected date. Your requests are highlighted.</div>
        </div>
        <div class="hero-right d-none d-sm-flex">
          <v-chip size="small" color="primary" label class="mr-1">Mine</v-chip>
          <v-chip size="small" label>Others</v-chip>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <v-card flat class="soft-card glass mb-3">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>Filters</span>
            <v-spacer />
            <v-btn size="small" variant="text" @click="loadSchedule" :loading="loading" prepend-icon="mdi-refresh">Refresh</v-btn>
          </v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field v-model="selectedDate" type="date" label="Date" variant="outlined" density="compact" hide-details />
              </v-col>
              <v-col cols="6" md="3">
                <v-select :items="['ALL','PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']"
                          v-model="statusFilter" label="Status" variant="outlined" density="compact" hide-details />
              </v-col>
              <v-col cols="6" md="3">
                <v-select :items="['ALL','Car','Messenger']"
                          v-model="categoryFilter" label="Category" variant="outlined" density="compact" hide-details />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model="qSearch" label="Search requester / purpose / destination"
                              prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-card flat class="soft-card glass">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

            <v-data-table
              :headers="headers" :items="filtered" :loading="loading"
              item-key="_id" density="comfortable" class="elevated"
              @click:row="onRowClick"
            >
              <template #loading><v-skeleton-loader type="table-row@6" /></template>

              <template #item.time="{ item }"><div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div></template>

              <template #item.category="{ item }">
                <v-chip :color="item.category === 'Car' ? 'primary' : 'orange'" size="small" label>
                  <v-icon start :icon="item.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'" /> {{ item.category }}
                </v-chip>
              </template>

              <template #item.requester="{ item }">
                <div class="d-flex align-center">
                  <v-chip v-if="item.isMine" size="x-small" color="primary" variant="elevated" class="mr-2">Mine</v-chip>
                  <div>
                    <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.employee?.department || '—' }} • ID {{ item.employeeId }}</div>
                  </div>
                </div>
              </template>

              <template #item.itinerary="{ item }">
                <div class="truncate-2">
                  {{ prettyStops(item.stops) }}
                  <v-btn v-if="item.ticketUrl" size="x-small" color="indigo" variant="tonal" class="ml-2"
                         @click.stop="openTicket(item.ticketUrl)">
                    <v-icon start icon="mdi-paperclip" /> Ticket
                  </v-btn>
                </div>
                <div class="text-caption mt-1" v-if="item.purpose || item.notes">
                  <span class="text-medium-emphasis">Purpose:</span> {{ item.purpose || '—' }}
                  <span v-if="item.notes"> • <span class="text-medium-emphasis">Notes:</span> {{ item.notes }}</span>
                </div>
              </template>

              <template #item.passengers="{ item }"><div class="text-center">{{ item.passengers ?? 1 }}</div></template>

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
                <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">No bookings on {{ selectedDate }}.</v-sheet>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </div>
    </v-sheet>

    <!-- Details dialog -->
    <v-dialog v-model="detailOpen" max-width="820">
      <v-card class="soft-card glass" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-chip :color="detailItem?.category === 'Car' ? 'primary' : 'orange'" size="small" label>
              <v-icon start :icon="detailItem?.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'" /> {{ detailItem?.category || '—' }}
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

            <v-col cols="12" md="6" v-if="detailItem?.customerContact">
              <div class="lbl">Customer Contact</div><div class="val">{{ detailItem?.customerContact }}</div>
            </v-col>

            <v-col cols="12">
              <div class="lbl">Itinerary</div>
              <div class="val">
                <div v-if="(detailItem?.stops || []).length" class="stops">
                  <div v-for="(s,i) in detailItem.stops" :key="i" class="stop">
                    <v-icon size="16" :icon="s.destination === 'Airport' ? 'mdi-airplane' : 'mdi-map-marker'" class="mr-1" />
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}</span>
                    <a v-if="s.mapLink" :href="absUrl(s.mapLink)" target="_blank" rel="noopener" class="ml-2 text-decoration-none">
                      <v-btn size="x-small" variant="text" color="primary"><v-icon start icon="mdi-link-variant" /> Map</v-btn>
                    </a>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6"><div class="lbl">Status</div>
              <div class="val"><v-chip :color="statusColor(detailItem?.status)" size="small" label>
                <v-icon start :icon="statusIcon(detailItem?.status)" /> {{ detailItem?.status || '—' }}</v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="6" v-if="detailItem?.ticketUrl">
              <div class="lbl">Ticket</div>
              <div class="val">
                <a :href="absUrl(detailItem.ticketUrl)" target="_blank" rel="noopener" class="text-decoration-none">
                  <v-btn size="small" color="indigo" variant="tonal">
                    <v-icon start icon="mdi-paperclip" /> VIEW TICKET
                  </v-btn>
                </a>
              </div>
            </v-col>

            <v-col cols="12" v-if="detailItem?.purpose || detailItem?.notes" class="mt-1">
              <div class="lbl">Purpose & Notes</div>
              <div class="val">
                <div><span class="text-medium-emphasis">Purpose:</span> {{ detailItem?.purpose || '—' }}</div>
                <div v-if="detailItem?.notes"><span class="text-medium-emphasis">Notes:</span> {{ detailItem?.notes }}</div>
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
.section { background: linear-gradient(180deg, rgba(134,136,231,.06), rgba(16,185,129,.05)); border: 1px solid rgba(100,116,139,.18); }
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%); color:#fff; }
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card { border: 1px solid rgba(209,218,229,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; }

.elevated { border: 1px solid rgba(100,116,139,.14); border-radius: 12px; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
</style>
