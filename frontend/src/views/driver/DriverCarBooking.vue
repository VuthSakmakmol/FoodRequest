<!-- src/views/driver/DriverCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch      = ref('')

/* Identity (same as before) */
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}
function detectIdentity() {
  const c = []
  try {
    const u = JSON.parse(localStorage.getItem('auth:user') || '{}')
    if (u && (u.loginId || u?.user?.loginId)) {
      c.push({ loginId: String(u.loginId || u?.user?.loginId), role: String(u.role || u?.user?.role || '').toUpperCase() })
    }
  } catch {}
  const flatLogin = localStorage.getItem('loginId')
  const flatRole  = (localStorage.getItem('role') || '').toUpperCase()
  if (flatLogin || flatRole) c.push({ loginId: String(flatLogin || ''), role: flatRole })

  try {
    const u2 = JSON.parse(sessionStorage.getItem('auth:user') || '{}')
    if (u2 && (u2.loginId || u2?.user?.loginId)) {
      c.push({ loginId: String(u2.loginId || u2?.user?.loginId), role: String(u2.role || u2?.user?.role || '').toUpperCase() })
    }
  } catch {}
  const sLogin = sessionStorage.getItem('loginId')
  const sRole  = (sessionStorage.getItem('role') || '').toUpperCase()
  if (sLogin || sRole) c.push({ loginId: String(sLogin || ''), role: sRole })

  const kLogin = readCookie('loginId')
  const kRole  = (readCookie('role') || '').toUpperCase()
  if (kLogin || kRole) c.push({ loginId: String(kLogin || ''), role: kRole })

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null')
      const candLogin = v?.loginId || v?.user?.loginId || v?.me?.loginId
      const candRole  = (v?.role || v?.user?.role || v?.me?.role || '').toUpperCase()
      if (candLogin && candRole) { c.push({ loginId: String(candLogin), role: candRole }); break }
    } catch {}
  }
  return c.find(x => x.loginId) || { loginId:'', role:'' }
}
const identity = ref(detectIdentity())

/* Dev identity bar */
const devLoginId = ref('')
const devRole = ref('DRIVER')
function useDevIdentity() {
  if (!devLoginId.value) return
  localStorage.setItem('loginId', devLoginId.value)
  localStorage.setItem('role', devRole.value)
  identity.value = { loginId: devLoginId.value, role: devRole.value }
  loadList()
}

/* Columns: add Driver Resp., keep Actions wide */
const headers = [
  { title: 'Time',         key: 'time',       sortable: true,  width: 160 },
  { title: 'Category',     key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',    key: 'requester',  sortable: true,  width: 230 },
  { title: 'Itinerary',    key: 'itinerary',  sortable: false },
  { title: 'Pax',          key: 'passengers', sortable: true,  width: 70, align: 'center' },
  { title: 'Status',       key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: 'Driver Resp.', key: 'driverAck',  sortable: true,  width: 150, align: 'end' },
  { title: '',             key: 'actions',    sortable: false, width: 330, align: 'end' },
]

/* Status + Ack styles + FA icons */
const statusColor = s => ({
  PENDING:'grey', ASSIGNED:'blue-grey', ACCEPTED:'primary', ON_ROAD:'info',
  ARRIVING:'teal', COMPLETED:'success', DELAYED:'warning', CANCELLED:'error', DECLINED:'error'
}[s] || 'grey')

const statusFa = s => ({
  PENDING:'fa-solid fa-hourglass-half',
  ASSIGNED:'fa-solid fa-user-check',
  ACCEPTED:'fa-solid fa-circle-check',
  ON_ROAD:'fa-solid fa-truck-fast',
  ARRIVING:'fa-solid fa-flag-checkered',
  COMPLETED:'fa-solid fa-check-double',
  DELAYED:'fa-solid fa-triangle-exclamation',
  CANCELLED:'fa-solid fa-ban',
  DECLINED:'fa-solid fa-circle-xmark'
}[s] || 'fa-solid fa-hourglass-half')

const ackColor = s => ({ PENDING:'grey', ACCEPTED:'success', DECLINED:'error' }[s] || 'grey')
const ackFa    = s => ({
  PENDING:'fa-solid fa-circle-question',
  ACCEPTED:'fa-solid fa-thumbs-up',
  DECLINED:'fa-solid fa-thumbs-down'
}[s] || 'fa-solid fa-circle-question')

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops.map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination).join(' → ')
}
function absUrl(u) {
  const base = (api.defaults.baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '')
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`
}

/* Load + booking-room subscriptions */
let leavePreviousRooms = null
async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    const params = { driverId: loginId, role }
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value

    const { data } = await api.get('/driver/car-bookings', {
      params,
      headers: { 'x-login-id': loginId || '', 'x-role': role || '' }
    })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {}
    }))

    // Subscribe to booking:<id> rooms for all visible rows
    try {
      const ids = rows.value.map(r => String(r._id)).filter(Boolean)
      if (leavePreviousRooms) { leavePreviousRooms(); leavePreviousRooms = null }
      leavePreviousRooms = subscribeBookingRooms(ids)
    } catch {}
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load bookings'
  } finally { loading.value = false }
}

const filtered = computed(() =>
  (rows.value || [])
    .filter(r => {
      const term = qSearch.value.trim().toLowerCase()
      if (!term) return true
      const hay = [r.employee?.name, r.employee?.department, r.employeeId, r.purpose, r.notes, prettyStops(r.stops)].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
)

/* Helpers to gate actions */
const isMine = (it) =>
  String(it?.assignment?.driverId || it?.driverId || it?.driverLoginId || '').toLowerCase() ===
  String(identity.value?.loginId || '').toLowerCase()

const canRespond = (it) => {
  const ack = String(it?.assignment?.driverAck || '').toUpperCase()
  return isMine(it) && !['ACCEPTED','DECLINED'].includes(ack)
}

/* driver can change status after ack ACCEPTED */
const terminalStates = ['CANCELLED','COMPLETED']
const ALLOWED_NEXT = {
  PENDING:   ['ACCEPTED','CANCELLED'],
  ACCEPTED:  ['ON_ROAD','DELAYED','CANCELLED'],
  ON_ROAD:   ['ARRIVING','DELAYED','CANCELLED'],
  ARRIVING:  ['COMPLETED','DELAYED','CANCELLED'],
  DELAYED:   ['ON_ROAD','ARRIVING','CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
}
const nextStatusesFor = (from) => ALLOWED_NEXT[String(from || '').toUpperCase()] || []
const canChangeStatus = (it) =>
  isMine(it) &&
  (it?.assignment?.driverAck === 'ACCEPTED') &&
  !terminalStates.includes(String(it?.status || '').toUpperCase())

/* Driver actions: ack + status */
const actLoading = ref('')
const statusLoading = ref('') // bookingId in-flight
const snack = ref(false)
const snackText = ref('')

async function sendAck(item, response) {
  if (!item?._id || actLoading.value) return
  actLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    await api.post(
      `/driver/car-bookings/${item._id}/ack`,
      { response },   // 'ACCEPTED' | 'DECLINED'
      { headers: { 'x-login-id': loginId || '', 'x-role': role || '' } }
    )
    item.assignment = { ...(item.assignment || {}), driverAck: response, driverAckAt: new Date().toISOString() }
    snackText.value = response === 'ACCEPTED' ? 'You acknowledged the assignment.' : 'You declined the assignment.'
    snack.value = true
  } catch (e) {
    snackText.value = e?.response?.data?.message || e?.message || 'Action failed'
    snack.value = true
  } finally {
    actLoading.value = ''
  }
}

async function setDriverStatus(item, nextStatus) {
  if (!item?._id || statusLoading.value) return
  statusLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    const prev = item.status
    item.status = nextStatus // optimistic
    await api.patch(
      `/driver/car-bookings/${item._id}/status`,
      { status: nextStatus },
      { headers: { 'x-login-id': loginId || '', 'x-role': role || '' } }
    )
    snackText.value = `Status updated to ${nextStatus}.`
    snack.value = true
  } catch (e) {
    await loadList()
    snackText.value = e?.response?.data?.message || e?.message || 'Failed to update status'
    snack.value = true
  } finally {
    statusLoading.value = ''
  }
}

/* Sockets: scoped event handlers */
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}
function onAssigned(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) {
    it.assignment = { ...(it.assignment||{}), driverId: p.driverId, driverName: p.driverName, driverAck: 'PENDING' }
  }
}
function onDriverAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.assignment = { ...(it.assignment || {}), driverAck: p.response, driverAckAt: p.at }
}

/* Mount/Unmount */
onMounted(() => {
  try { subscribeRoleIfNeeded({ role: 'DRIVER' }) } catch {}
  loadList()
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', onAssigned)
  socket.on('carBooking:driverAck', onDriverAck)
})
onBeforeUnmount(() => {
  socket.off('carBooking:status', onStatus)
  socket.off('carBooking:assigned', onAssigned)
  socket.off('carBooking:driverAck', onDriverAck)
  if (leavePreviousRooms) { leavePreviousRooms(); leavePreviousRooms = null }
})
watch([selectedDate, statusFilter], loadList)

/* Detail dialog */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }
</script>

<template>
  <v-container fluid class="pa-2">
    <!-- identity bar -->
    <v-alert
      v-if="!identity?.loginId"
      type="warning" variant="tonal" class="mb-2"
      title="Dev identity not detected"
      text="Enter your loginId (e.g., driver01) to load assigned bookings."
    />
    <div v-if="!identity?.loginId" class="d-flex align-center mb-2" style="gap:8px;">
      <v-text-field v-model="devLoginId" label="loginId" density="compact" variant="outlined" style="max-width:220px;" hide-details />
      <v-select :items="['DRIVER','MESSENGER']" v-model="devRole" density="compact" variant="outlined" hide-details style="max-width:160px;" />
      <v-btn color="primary" size="small" @click="useDevIdentity">USE</v-btn>
    </div>

    <v-sheet class="driver-section pa-0" rounded="lg">
      <div class="driver-header">
        <div class="hdr-left">
          <div class="hdr-title">
            <i class="fa-solid fa-clipboard-list"></i>
            <span>Car Bookings — All Status</span>
          </div>
          <div class="hdr-sub">Assigned to you. Acknowledge and keep status updated.</div>
        </div>
        <div class="hdr-actions">
          <v-btn size="small" variant="text" :loading="loading" @click="loadList">
            <i class="fa-solid fa-rotate-right mr-1"></i> REFRESH
          </v-btn>
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
                <v-text-field v-model="selectedDate" type="date" label="Date (optional)" variant="outlined" density="compact" hide-details clearable />
              </v-col>
              <v-col cols="6" md="3">
                <v-select :items="['ALL','PENDING','ASSIGNED','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED','DECLINED']"
                          v-model="statusFilter" label="Status" variant="outlined" density="compact" hide-details />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="qSearch" label="Search requester / purpose / destination"
                              variant="outlined" density="compact" hide-details clearable>
                  <template #prepend-inner>
                    <i class="fa-solid fa-magnifying-glass"></i>
                  </template>
                </v-text-field>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

            <v-data-table :headers="headers" :items="filtered" :loading="loading" item-key="_id" density="comfortable" class="elevated">
              <template #loading><v-skeleton-loader type="table-row@6" /></template>

              <template #item.time="{ item }">
                <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.tripDate }}</div>
              </template>

              <template #item.category="{ item }">
                <v-chip :color="item.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
                  <i class="fa-solid" :class="item.category === 'Car' ? 'fa-car' : 'fa-motorcycle'"></i>
                  <span class="ml-2">{{ item.category }}</span>
                </v-chip>
              </template>

              <template #item.requester="{ item }">
                <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.employee?.department || '—' }} • ID {{ item.employeeId }}</div>
              </template>

              <template #item.itinerary="{ item }">
                <div class="truncate-2">{{ prettyStops(item.stops) }}</div>
                <div class="mt-1" v-if="item.ticketUrl">
                  <a :href="absUrl(item.ticketUrl)" target="_blank" rel="noopener" class="text-decoration-none">
                    <v-btn size="x-small" color="indigo" variant="tonal"><i class="fa-solid fa-paperclip mr-1"></i> Ticket</v-btn>
                  </a>
                </div>
              </template>

              <template #item.passengers="{ item }"><div class="text-center">{{ item.passengers ?? 1 }}</div></template>

              <template #item.status="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" label>
                  <i :class="statusFa(item.status)" class="mr-1"></i> {{ item.status }}
                </v-chip>
              </template>

              <template #item.driverAck="{ item }">
                <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(item.assignment?.driverAck || 'PENDING')" class="mr-1"></i>
                  {{ (item.assignment?.driverAck || 'PENDING') }}
                </v-chip>
              </template>

              <!-- ACTIONS -->
              <template #item.actions="{ item }">
                <div class="d-flex justify-end" style="gap:6px; flex-wrap: wrap;">
                  <!-- Step 1: driver ack -->
                  <template v-if="canRespond(item)">
                    <v-btn size="small" color="success" variant="flat"
                      :loading="actLoading === String(item._id)"
                      @click.stop="sendAck(item,'ACCEPTED')">
                      <i class="fa-solid fa-check mr-1"></i> Accept
                    </v-btn>
                    <v-btn size="small" color="error" variant="tonal"
                      :loading="actLoading === String(item._id)"
                      @click.stop="sendAck(item,'DECLINED')">
                      <i class="fa-solid fa-xmark mr-1"></i> Decline
                    </v-btn>
                  </template>

                  <!-- Step 2: live status (after ack ACCEPTED) -->
                  <template v-if="canChangeStatus(item)">
                    <v-menu location="bottom end">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" size="small" variant="tonal" color="primary"
                               :loading="statusLoading === String(item._id)">
                          <i class="fa-solid fa-arrows-rotate mr-2"></i> Update Status
                        </v-btn>
                      </template>
                      <v-list density="compact" min-width="220">
                        <v-list-subheader>Next status</v-list-subheader>
                        <v-list-item v-for="s in nextStatusesFor(item.status)" :key="s" @click.stop="setDriverStatus(item, s)">
                          <template #prepend><i :class="statusFa(s)"></i></template>
                          <v-list-item-title>{{ s }}</v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-menu>
                  </template>

                  <v-btn size="small" variant="tonal" color="primary" @click.stop="showDetails(item)">
                    <i class="fa-solid fa-circle-info mr-1"></i> Details
                  </v-btn>
                </div>
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
            <v-chip :color="detailItem?.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
              <i class="fa-solid" :class="detailItem?.category === 'Car' ? 'fa-car' : 'fa-motorcycle'"></i>
              <span class="ml-2">{{ detailItem?.category || '—' }}</span>
            </v-chip>
            <span class="mono">{{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}</span>
          </div>
          <v-btn icon variant="text" @click="detailOpen = false">
            <i class="fa-solid fa-xmark"></i>
          </v-btn>
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
                <div class="text-caption text-medium-emphasis">{{ detailItem?.employee?.department || '—' }} • ID {{ detailItem?.employeeId }}</div>
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
              <div class="lbl">Status</div>
              <div class="val">
                <v-chip :color="statusColor(detailItem?.status)" size="small" label>
                  <i :class="statusFa(detailItem?.status)" class="mr-1"></i>
                  {{ detailItem?.status || '—' }}
                </v-chip>
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
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end" style="gap:8px;">
          <template v-if="detailItem && canRespond(detailItem)">
            <v-btn size="small" color="success" variant="flat" :loading="actLoading === String(detailItem?._id)" @click="sendAck(detailItem,'ACCEPTED')">
              <i class="fa-solid fa-check mr-1"></i> Accept
            </v-btn>
            <v-btn size="small" color="error" variant="tonal" :loading="actLoading === String(detailItem?._id)" @click="sendAck(detailItem,'DECLINED')">
              <i class="fa-solid fa-xmark mr-1"></i> Decline
            </v-btn>
          </template>
          <template v-if="detailItem && canChangeStatus(detailItem)">
            <v-menu location="bottom end">
              <template #activator="{ props }">
                <v-btn v-bind="props" size="small" variant="tonal" color="primary" :loading="statusLoading === String(detailItem?._id)">
                  <i class="fa-solid fa-arrows-rotate mr-2"></i> Update Status
                </v-btn>
              </template>
              <v-list density="compact" min-width="220">
                <v-list-subheader>Next status</v-list-subheader>
                <v-list-item v-for="s in nextStatusesFor(detailItem.status)" :key="s" @click.stop="setDriverStatus(detailItem, s)">
                  <template #prepend><i :class="statusFa(s)"></i></template>
                  <v-list-item-title>{{ s }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </template>
          <v-btn variant="text" @click="detailOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack" timeout="2200" location="bottom right">
      {{ snackText }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.driver-section { border: 1px solid #e6e8ee; background:#fff; border-radius: 12px; }
.driver-header { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: var(--surface, #f5f7fb); border-bottom: 1px solid #e6e8ee; }
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

/* small spacing helpers for FA icons */
.mr-1 { margin-right: .25rem; } .mr-2 { margin-right: .5rem; }
.ml-2 { margin-left: .5rem; }
</style>
