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

const updating = ref({}) // { [bookingId]: boolean }

/* Workflow */
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

/* Helpers */
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '')
const absUrl = (u) => !u ? '' : (/^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u.startsWith('/')?'':'/'}${u}`)
const openTicket = (u) => { const url = absUrl(u); if (url) window.open(url, '_blank', 'noopener,noreferrer') }

/* Table */
const headers = [
  { title: 'Time',        key: 'time',       sortable: true,  width: 240 },
  { title: 'Category',    key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',   key: 'requester',  sortable: true,  width: 360 },
  { title: 'Itinerary',   key: 'itinerary',  sortable: false, width: 350 },
  { title: 'Pax',         key: 'passengers', sortable: true,  width: 70,  align: 'center' },
  { title: 'Purpose',     key: 'purpose',    sortable: false, width: 260 },
  { title: 'Assigned',    key: 'assigned',   sortable: false, width: 160 },
  { title: 'Driver Resp.',key: 'driverAck',  sortable: false, width: 150, align: 'end' },
  { title: 'Status',      key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: '',            key: 'actions',    sortable: false, width: 140, align: 'end' }
]

async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = {}
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    if (categoryFilter.value !== 'ALL') params.category = categoryFilter.value
    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {}   // expect driverAck here
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
  } finally { loading.value = false }
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops.map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination).join(' → ')
}

/* Status + Ack colors + FA icons */
const statusColor = s => ({
  PENDING:'grey', ACCEPTED:'primary', ON_ROAD:'info', ARRIVING:'teal',
  COMPLETED:'success', DELAYED:'warning', CANCELLED:'error'
}[s] || 'grey')

const statusFa = s => ({
  PENDING:'fa-solid fa-hourglass-half',
  ACCEPTED:'fa-solid fa-circle-check',
  ON_ROAD:'fa-solid fa-truck-fast',
  ARRIVING:'fa-solid fa-flag-checkered',
  COMPLETED:'fa-solid fa-check-double',
  DELAYED:'fa-solid fa-triangle-exclamation',
  CANCELLED:'fa-solid fa-ban'
}[s] || 'fa-solid fa-hourglass-half')

const ackColor = s => ({ PENDING:'grey', ACCEPTED:'success', DECLINED:'error' }[s] || 'grey')
const ackFa  = s => ({
  PENDING:'fa-solid fa-circle-question',
  ACCEPTED:'fa-solid fa-thumbs-up',
  DECLINED:'fa-solid fa-thumbs-down'
}[s] || 'fa-solid fa-circle-question')

/* Assigned chip helpers */
const assigneeName  = (it) => it?.assignment?.driverName || it?.assignment?.driverId || ''
const assigneeColor = (it) => (it?.category === 'Messenger' ? 'deep-orange' : 'indigo')
const assigneeIconFA = (it) => (it?.category === 'Messenger' ? 'fa-motorcycle' : 'fa-car')

/* Search/filter/sort */
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name, r.employee?.department, r.employeeId,
        r.purpose, prettyStops(r.stops), assigneeName(r), r.assignment?.driverAck
      ].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

/* Sockets */
function onCreated(doc) {
  if (!doc?.tripDate) return
  if (selectedDate.value && doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) rows.value.push({ ...doc, stops: doc.stops || [], assignment: doc.assignment || {} })
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}
function onAssigned(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) {
    it.assignment = { ...(it.assignment||{}), driverId: p.driverId, driverName: p.driverName, driverAck: 'PENDING' }
    if (it.status === 'PENDING') it.status = 'ACCEPTED'   // admin accepted request
  }
}
function onDriverAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.assignment = { ...(it.assignment || {}), driverAck: p.response, driverAckAt: p.at }
}

onMounted(() => {
  try { subscribeRoleIfNeeded({ role: 'ADMIN' }) } catch {}
  loadSchedule()
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', onAssigned)
  socket.on('carBooking:driverAck', onDriverAck)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
  socket.off('carBooking:assigned', onAssigned)
  socket.off('carBooking:driverAck', onDriverAck)
})

watch([selectedDate, statusFilter, categoryFilter], loadSchedule)

/* Details dialog */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }

/* Assign flow */
const assignOpen = ref(false)
const assignTarget = ref(null)
const assignLoading = ref(false)
const assignError = ref('')
const loadingPeople = ref(false)
const people = ref([])
const selectedLoginId = ref('')
const busyLoginIds = ref(new Set())
const roleFromItem = (item) => (item?.category === 'Messenger' ? 'MESSENGER' : 'DRIVER')

async function fetchFirstOk(requests) {
  for (const r of requests) {
    try { const res = await r(); if (Array.isArray(res?.data)) return res.data } catch {}
  }
  return []
}
const isBusy = (loginId) => busyLoginIds.value.has(String(loginId))

async function loadPeopleFor(item) {
  loadingPeople.value = true
  people.value = []
  busyLoginIds.value = new Set()
  selectedLoginId.value = item?.assignment?.driverId || ''

  const role = roleFromItem(item)
  const list = await fetchFirstOk([
    () => api.get(role === 'DRIVER' ? '/admin/drivers' : '/admin/messengers'),
    () => api.get('/admin/users', { params: { role } })
  ])
  people.value = list.map(u => ({
    _id: String(u._id || u.id || u.loginId),
    loginId: String(u.loginId || ''),
    name: u.name || u.fullName || u.loginId || '—'
  }))

  try {
    const { data } = await api.get('/admin/availability/assignees', {
      params: { role, date: item.tripDate, start: item.timeStart, end: item.timeEnd }
    })
    busyLoginIds.value = new Set((data?.busy || []).map(String))
  } catch { busyLoginIds.value = new Set() }

  loadingPeople.value = false
}

function openAssignDialog(item) {
  assignTarget.value = item
  assignError.value = ''
  assignOpen.value = true
  loadPeopleFor(item)
}

async function submitAssign() {
  if (!assignTarget.value?._id) return
  if (!selectedLoginId.value) { assignError.value = 'Please select exactly one Driver/Messenger card'; return }
  if (isBusy(selectedLoginId.value)) { assignError.value = 'This person is busy in this window.'; return }
  assignLoading.value = true
  assignError.value = ''
  try {
    await api.post(`/admin/car-bookings/${assignTarget.value._id}/assign`, {
      driverId: selectedLoginId.value,
      status: 'ACCEPTED'
    })
    const it = rows.value.find(x => String(x._id) === String(assignTarget.value._id))
    if (it) {
      it.assignment = { ...(it.assignment || {}), driverId: selectedLoginId.value, driverAck: 'PENDING' }
      it.status = 'ACCEPTED'
    }
    assignOpen.value = false
  } catch (e) {
    assignError.value = e?.response?.data?.message || e?.message || 'Failed to assign'
  } finally {
    assignLoading.value = false
  }
}

/* Status update */
async function updateStatus(item, nextStatus){
  if (!item?._id || !nextStatus) return
  const allowed = nextStatuses(item.status)
  if (!allowed.includes(nextStatus)) { error.value = `Cannot change from ${item.status} to ${nextStatus}`; return }
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
          <div class="hero-sub">Admin accepts customer → assigns driver → driver must acknowledge (Accept/Decline).</div>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <v-card flat class="soft-card mb-3">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>Filters</span>
            <v-spacer />
            <v-btn size="small" variant="text" @click="loadSchedule" :loading="loading">
              <i class="fa-solid fa-rotate-right mr-1"></i> Refresh
            </v-btn>
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
                <v-text-field v-model="qSearch" label="Search requester / purpose / destination / assignee / driverResp"
                              variant="outlined" density="compact" hide-details clearable>
                  <template #prepend-inner><i class="fa-solid fa-magnifying-glass"></i></template>
                </v-text-field>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

            <v-data-table :headers="headers" :items="filtered" :loading="loading"
                          item-key="_id" density="comfortable" class="elevated">

              <template #loading><v-skeleton-loader type="table-row@6" /></template>

              <template #item.time="{ item }"><div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div></template>

              <template #item.category="{ item }">
                <v-chip :color="item.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
                  <i class="fa-solid" :class="item.category === 'Car' ? 'fa-car' : 'fa-motorcycle'"></i>
                  <span class="ml-2">{{ item.category }}</span>
                </v-chip>
              </template>

              <template #item.requester="{ item }">
                <div class="d-flex align-center">
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
                    <i class="fa-solid fa-paperclip mr-1"></i> Ticket
                  </v-btn>
                </div>
              </template>

              <template #item.passengers="{ item }"><div class="text-center">{{ item.passengers ?? 1 }}</div></template>

              <template #item.purpose="{ item }">
                <div class="purpose-pill">
                  <i class="fa-regular fa-lightbulb mr-2"></i>
                  <span class="purpose-text">{{ item.purpose || '—' }}</span>
                </div>
              </template>

              <template #item.assigned="{ item }">
                <div class="d-flex align-center" style="gap:6px;">
                  <template v-if="assigneeName(item)">
                    <v-chip :color="assigneeColor(item)" size="small" class="assignee-chip" label>
                      <i class="fa-solid mr-2" :class="assigneeIconFA(item)"></i>
                      {{ assigneeName(item) }}
                    </v-chip>
                  </template>
                  <template v-else>
                    <v-chip color="grey" size="small" variant="tonal" class="assignee-chip" label>
                      <i class="fa-solid fa-user-slash mr-2"></i> Unassigned
                    </v-chip>
                  </template>
                </div>
              </template>

              <template #item.driverAck="{ item }">
                <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(item.assignment?.driverAck || 'PENDING')" class="mr-1"></i>
                  {{ (item.assignment?.driverAck || 'PENDING') }}
                </v-chip>
              </template>

              <template #item.status="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" label>
                  <i :class="statusFa(item.status)" class="mr-1"></i>
                  {{ item.status }}
                </v-chip>
              </template>

              <template #item.actions="{ item }">
                <v-menu location="bottom end">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" size="small" variant="tonal" color="primary" :loading="!!updating[item._id]">
                      <i class="fa-solid fa-arrows-rotate mr-2"></i> Update
                    </v-btn>
                  </template>
                  <v-list density="compact" min-width="260">
                    <v-list-subheader>Next status</v-list-subheader>
                    <template v-if="nextStatuses(item.status).length">
                      <v-list-item v-for="s in nextStatuses(item.status)" :key="s" @click.stop="updateStatus(item, s)">
                        <template #prepend><i :class="statusFa(s)"></i></template>
                        <v-list-item-title>{{ s }}</v-list-item-title>
                      </v-list-item>
                    </template>
                    <v-list-item v-else disabled>
                      <template #prepend><i class="fa-solid fa-lock"></i></template>
                      <v-list-item-title>No further changes</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>

                <v-btn size="small" variant="text" color="secondary" class="ml-1" @click.stop="openAssignDialog(item)">
                  <i class="fa-solid fa-id-badge mr-2"></i> Assign
                </v-btn>

                <v-btn size="small" variant="text" color="secondary" class="ml-1" @click.stop="showDetails(item)">
                  <i class="fa-solid fa-circle-info mr-2"></i> Details
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
    <v-dialog v-model="detailOpen" max-width="860">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-chip :color="detailItem?.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
              <i class="fa-solid" :class="detailItem?.category === 'Car' ? 'fa-car' : 'fa-motorcycle'"></i>
              <span class="ml-2">{{ detailItem?.category || '—' }}</span>
            </v-chip>
            <span class="mono">{{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}</span>
          </div>
          <v-btn icon variant="text" @click="detailOpen = false"><i class="fa-solid fa-xmark"></i></v-btn>
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
                    <i :class="s.destination === 'Airport' ? 'fa-solid fa-plane' : 'fa-solid fa-location-dot'" class="mr-1"></i>
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}</span>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">Driver Response</div>
              <div class="val">
                <v-chip :color="ackColor(detailItem?.assignment?.driverAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(detailItem?.assignment?.driverAck || 'PENDING')" class="mr-1"></i>
                  {{ detailItem?.assignment?.driverAck || 'PENDING' }}
                </v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="6" v-if="detailItem?.ticketUrl">
              <div class="lbl">Ticket</div>
              <div class="val">
                <a :href="absUrl(detailItem.ticketUrl)" target="_blank" rel="noopener" class="text-decoration-none">
                  <v-btn size="small" color="indigo" variant="tonal">
                    <i class="fa-solid fa-paperclip mr-2"></i> VIEW TICKET
                  </v-btn>
                </a>
              </div>
            </v-col>

            <v-col cols="12" v-if="detailItem?.purpose">
              <div class="lbl">Purpose</div>
              <div class="val purpose-detail">{{ detailItem?.purpose }}</div>
            </v-col>

            <v-col cols="12" v-if="detailItem?.notes">
              <div class="lbl">Notes</div>
              <div class="notes-block">
                {{ detailItem?.notes }}
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="detailOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Assign dialog (your existing content can remain; no mdi icons used there except we already use FA elsewhere) -->
    <v-dialog v-model="assignOpen" max-width="860">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <i class="fa-solid fa-id-badge"></i>
            <span class="ml-2">Select Driver/Messenger</span>
          </div>
          <v-btn icon variant="text" @click="assignOpen = false"><i class="fa-solid fa-xmark"></i></v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-alert v-if="assignError" type="error" variant="tonal" border="start" class="mb-3">{{ assignError }}</v-alert>
          <v-skeleton-loader v-if="loadingPeople" type="card, card, card" />
          <template v-else>
            <div v-if="!people.length" class="text-medium-emphasis">No users found for this role.</div>
            <v-row dense>
              <v-col v-for="p in people" :key="p._id" cols="12" sm="6" md="4" lg="3">
                <v-card
                  class="person-card"
                  :class="{ selected: selectedLoginId === p.loginId, busy: isBusy(p.loginId) }"
                  :disabled="isBusy(p.loginId)"
                  variant="outlined"
                  rounded="lg"
                  @click="!isBusy(p.loginId) && (selectedLoginId = p.loginId)"
                >
                  <v-card-text class="py-4">
                    <div class="d-flex align-center" style="gap:10px;">
                      <v-avatar size="44"><i class="fa-solid fa-user"></i></v-avatar>
                      <div>
                        <div class="font-weight-700">{{ p.name }}</div>
                        <div class="text-caption text-medium-emphasis mono">ID: {{ p.loginId }}</div>
                        <div v-if="isBusy(p.loginId)" class="text-caption text-error mt-1">
                          <i class="fa-solid fa-circle-exclamation mr-1"></i> Busy in this window
                        </div>
                      </div>
                    </div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </template>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="assignOpen = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!selectedLoginId" :loading="assignLoading" @click="submitAssign">
            <i class="fa-solid fa-check mr-2"></i> Assign & Accept
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.section { border: 1px solid #e6e8ee; background:#fff; border-radius: 12px; }
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background:#f5f7fb; border-bottom: 1px solid #e6e8ee; }
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:800; color:#1f2a44; }
.hero-sub { color:#64748b; font-size:.9rem; }

.soft-card { border: 1px solid #e9ecf3; border-radius: 12px; background:#fff; }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:800; color:#1f2a44; }

.elevated { border: 1px solid #e9ecf3; border-radius: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* Purpose styling in table */
.purpose-pill {
  display:flex; align-items:center;
  background: #eef2ff; border: 1px solid #dfe3fb;
  padding: 6px 10px; border-radius: 10px; min-height: 32px;
}
.purpose-text { font-weight: 500; font-size: .98rem; color:#30336b; }

.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.purpose-detail { font-weight:500; font-size:1.05rem; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }

/* Notes block only in details */
.notes-block {
  border: 1px dashed #cbd5e1; background:#f8fafc;
  padding: 10px 12px; border-radius: 10px; white-space: pre-wrap;
}

/* Person card selection */
.person-card { cursor: pointer; transition: transform .06s ease, box-shadow .06s ease, border-color .06s ease; }
.person-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
.person-card.selected { border-color:#1f2a44; box-shadow: 0 0 0 2px rgba(31,42,68,0.15) inset; }
.person-card.busy { opacity:.55; border-color:#ef4444; cursor:not-allowed; }

i.fa-solid, i.fa-regular { line-height: 1; }
.mr-1 { margin-right: .25rem; } .mr-2 { margin-right: .5rem; }
.ml-2 { margin-left: .5rem; }

.assignee-chip { font-weight: 600; }
</style>
