<!-- src/views/admin/carbooking/AdminCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate   = ref('')
const statusFilter   = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch        = ref('')

// Per-row update state
const updating = ref({})   // { [bookingId]: boolean }

// Allowed forward transitions (no going back)
const ALLOWED_NEXT = {
  PENDING:   ['ACCEPTED','CANCELLED'],
  ACCEPTED:  ['ON_ROAD','DELAYED','CANCELLED'],
  ON_ROAD:   ['ARRIVING','DELAYED','CANCELLED'],
  ARRIVING:  ['COMPLETED','DELAYED','CANCELLED'],
  DELAYED:   ['ON_ROAD','ARRIVING','CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
}
const nextStatuses = (from) => ALLOWED_NEXT[from] || []

// Build absolute URL to API origin for /uploads links
const API_ORIGIN = (api.defaults.baseURL || '')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '')
function absUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`
}
function openTicket(u) {
  const url = absUrl(u)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

// Data table headers
const headers = [
  { title: 'Time',        key: 'time',       sortable: true,  width: 140 },
  { title: 'Category',    key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',   key: 'requester',  sortable: true,  width: 220 },
  { title: 'Itinerary',   key: 'itinerary',  sortable: false },
  { title: 'Pax',         key: 'passengers', sortable: true,  width: 70, align: 'center' },
  { title: 'Status',      key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: '',            key: 'actions',    sortable: false, width: 200, align: 'end' }
]

// Load schedule (all requests for admins)
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = {}
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {}
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

// Socket event handlers
function onCreated(doc) {
  if (!doc?.tripDate) return
  if (selectedDate.value && doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) {
    rows.value.push({ ...doc, stops: doc.stops || [], assignment: doc.assignment || {} })
  }
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

onMounted(() => {
  try { subscribeRoleIfNeeded() } catch {}
  loadSchedule()
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
})

watch([selectedDate, statusFilter], loadSchedule)

// Details dialog (open only via button)
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }

/* ============================
   Assign Driver flow (NEW)
   - Clicking "ACCEPTED" opens this dialog and requires assignment
   - Submits to /admin/car-bookings/:id/assign with payload
   ============================ */
const assignOpen = ref(false)
const assignTarget = ref(null)
const drivers = ref([])
const vehicles = ref([])
const assignLoading = ref(false)
const assignError = ref('')
const assignForm = ref({
  driverId: '',
  vehicleId: '',
  notes: ''
})

async function loadDriversAndVehicles() {
  // Adjust endpoints to your backend. Examples:
  // GET /admin/drivers  -> [{id,name}, ...]
  // GET /admin/vehicles -> [{id,name}, ...]
  try {
    const [dRes, vRes] = await Promise.all([
      api.get('/admin/drivers'),
      api.get('/admin/vehicles')
    ])
    drivers.value  = Array.isArray(dRes.data) ? dRes.data : []
    vehicles.value = Array.isArray(vRes.data) ? vRes.data : []
  } catch (e) {
    // If you don't have endpoints yet, keep empty lists but allow manual text fallback
    drivers.value  = drivers.value || []
    vehicles.value = vehicles.value || []
  }
}

function openAssignDialog(item) {
  assignTarget.value = item
  assignError.value = ''
  assignForm.value = {
    driverId: item?.assignment?.driverId || '',
    vehicleId: item?.assignment?.vehicleId || '',
    notes: item?.assignment?.notes || ''
  }
  assignOpen.value = true
  loadDriversAndVehicles()
}

async function submitAssign() {
  if (!assignTarget.value?._id) return
  if (!assignForm.value.driverId) { assignError.value = 'Please select a driver'; return }
  assignLoading.value = true
  assignError.value = ''
  try {
    // Call your assign endpoint (recommended) — includes desired status
    // Backend should:
    // 1) Save assignment (driverId/vehicleId/notes + assignedBy* + assignedAt)
    // 2) Set status to ACCEPTED
    // 3) Emit socket updates for admin/driver
    await api.post(`/admin/car-bookings/${assignTarget.value._id}/assign`, {
      driverId: assignForm.value.driverId,
      vehicleId: assignForm.value.vehicleId || '',
      notes: assignForm.value.notes || '',
      status: 'ACCEPTED'
    })

    // Optimistic local update
    const it = rows.value.find(x => String(x._id) === String(assignTarget.value._id))
    if (it) {
      it.assignment = {
        ...(it.assignment || {}),
        driverId: assignForm.value.driverId,
        driverName: (drivers.value.find(d => (d.id||d._id)===assignForm.value.driverId)?.name) || it.assignment?.driverName || '',
        vehicleId: assignForm.value.vehicleId || '',
        vehicleName: (vehicles.value.find(v => (v.id||v._id)===assignForm.value.vehicleId)?.name) || it.assignment?.vehicleName || '',
        notes: assignForm.value.notes || '',
      }
      it.status = 'ACCEPTED'
    }

    assignOpen.value = false
  } catch (e) {
    assignError.value = e?.response?.data?.message || e?.message || 'Failed to assign driver'
  } finally {
    assignLoading.value = false
  }
}

// ---- Admin: update status (forward-only). Intercept ACCEPTED -> open assignment dialog
async function updateStatus(item, nextStatus){
  if (!item?._id || !nextStatus) return
  const allowed = nextStatuses(item.status)
  if (!allowed.includes(nextStatus)) {
    error.value = `Cannot change from ${item.status} to ${nextStatus}`
    return
  }

  // If target status is ACCEPTED, require assignment instead of direct PATCH
  if (nextStatus === 'ACCEPTED') {
    openAssignDialog(item)
    return
  }

  updating.value[item._id] = true
  try {
    const prev = item.status
    item.status = nextStatus // optimistic
    await api.patch(`/admin/car-bookings/${item._id}/status`, { status: nextStatus })
  } catch (e) {
    await loadSchedule()
    error.value = e?.response?.data?.message || e?.message || 'Failed to update status'
  } finally {
    updating.value[item._id] = false
  }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
      <div class="hero">
        <div class="hero-left">
          <div class="hero-title">
            <i class="fa-solid fa-steering-wheel"></i>
            <span>Admin — Day Schedule (All Requests)</span>
          </div>
          <div class="hero-sub">Browse every booking. Filter by date when needed. Live updates.</div>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <v-card flat class="soft-card mb-3">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>Filters</span>
            <v-spacer />
            <v-btn size="small" variant="text" @click="loadSchedule" :loading="loading" prepend-icon="mdi-refresh">Refresh</v-btn>
          </v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field v-model="selectedDate" type="date" label="Date (optional)" variant="outlined" density="compact" hide-details clearable />
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

        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

            <v-data-table
              :headers="headers" :items="filtered" :loading="loading"
              item-key="_id" density="comfortable" class="elevated"
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
                  <div>
                    <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.employee?.department || '—' }} • ID {{ item.employeeId }}</div>
                    <div v-if="item.assignment?.driverName" class="text-caption mt-1">
                      <v-icon size="14" icon="mdi-steering" class="mr-1" /> Driver:
                      <strong>{{ item.assignment.driverName }}</strong>
                      <span v-if="item.assignment.vehicleName" class="ml-1">• {{ item.assignment.vehicleName }}</span>
                    </div>
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
                <v-menu location="bottom end">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" size="small" variant="tonal" color="primary" :loading="!!updating[item._id]">
                      <v-icon start icon="mdi-swap-horizontal" /> Update
                    </v-btn>
                  </template>

                  <v-list density="compact" min-width="220">
                    <v-list-subheader>Next status</v-list-subheader>

                    <template v-if="nextStatuses(item.status).length">
                      <v-list-item
                        v-for="s in nextStatuses(item.status)" :key="s"
                        @click.stop="updateStatus(item, s)"
                      >
                        <template #prepend><v-icon :icon="statusIcon(s)" /></template>
                        <v-list-item-title>
                          {{ s }}<span v-if="s==='ACCEPTED'" class="text-caption text-medium-emphasis"> — requires driver</span>
                        </v-list-item-title>
                      </v-list-item>
                    </template>

                    <v-list-item v-else disabled>
                      <template #prepend><v-icon icon="mdi-lock" /></template>
                      <v-list-item-title>No further changes</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>

                <v-btn size="small" variant="text" color="secondary" class="ml-1" @click.stop="showDetails(item)">
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

            <v-col cols="12" md="6">
              <div class="lbl">Status</div>
              <div class="d-flex align-center" style="gap:10px;">
                <v-chip :color="statusColor(detailItem?.status)" size="small" label>
                  <v-icon start :icon="statusIcon(detailItem?.status)" /> {{ detailItem?.status || '—' }}
                </v-chip>
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

            <v-col cols="12" v-if="detailItem?.assignment?.driverName || detailItem?.assignment?.vehicleName">
              <div class="lbl">Assignment</div>
              <div class="val">
                <div v-if="detailItem?.assignment?.driverName">
                  Driver: {{ detailItem.assignment.driverName }}
                </div>
                <div v-if="detailItem?.assignment?.vehicleName">
                  Vehicle: {{ detailItem.assignment.vehicleName }}
                </div>
                <div v-if="detailItem?.assignment?.notes" class="text-caption mt-1">
                  Notes: {{ detailItem.assignment.notes }}
                </div>
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

    <!-- Assign Driver dialog (NEW) -->
    <v-dialog v-model="assignOpen" max-width="560">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-icon icon="mdi-account-tie" class="mr-1" />
            <span>Assign Driver</span>
          </div>
          <v-btn icon="mdi-close" variant="text" @click="assignOpen = false" />
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-alert v-if="assignError" type="error" variant="tonal" border="start" class="mb-3">{{ assignError }}</v-alert>

          <v-row dense>
            <v-col cols="12">
              <v-select
                :items="drivers.map(d => ({ title: d.name || d.fullName || d.loginId || d.id || d._id, value: d.id || d._id }))"
                v-model="assignForm.driverId"
                label="Driver"
                variant="outlined"
                density="compact"
                hide-details
                clearable
                prepend-inner-icon="mdi-steering"
              />
            </v-col>
            <v-col cols="12">
              <v-select
                :items="vehicles.map(v => ({ title: v.name || v.plate || v.id || v._id, value: v.id || v._id }))"
                v-model="assignForm.vehicleId"
                label="Vehicle (optional)"
                variant="outlined"
                density="compact"
                hide-details
                clearable
                prepend-inner-icon="mdi-car"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="assignForm.notes"
                label="Notes (optional)"
                rows="3"
                auto-grow
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="assignOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="assignLoading" @click="submitAssign">
            <v-icon start icon="mdi-check" /> Assign & Accept
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
/* Professional, minimal palette to match the app */
.section { border: 1px solid #e6e8ee; background:#fff; border-radius: 12px; }
.hero {
  display:flex; align-items:center; justify-content:space-between;
  padding: 14px 18px; background: var(--surface, #f5f7fb); border-bottom: 1px solid #e6e8ee;
}
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:800; color: var(--brand, #1f2a44); }
.hero-sub { color:#64748b; font-size:.9rem; }

.soft-card { border: 1px solid #e9ecf3; border-radius: 12px; background:#fff; }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:800; color: var(--brand, #1f2a44); }

.elevated { border: 1px solid #e9ecf3; border-radius: 12px; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.text-caption .text-medium-emphasis { color:#64748b; }
</style>
