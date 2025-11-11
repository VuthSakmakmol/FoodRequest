<!-- src/views/messenger/MessengerCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'
import { useRoute, useRouter } from 'vue-router'

/* ───────── State ───────── */
const loading = ref(false)
const error = ref('')
const rows = ref([])

const route = useRoute()
const router = useRouter()
const focusId = ref(route.query.focus || '')
const focusDate = ref(route.query.date || '')


const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch = ref('')

/* ───────── Identity (Messenger) ───────── */
function readCookie(name) {
  const m = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
  )
  return m ? decodeURIComponent(m[1]) : ''
}
function detectIdentity() {
  const sources = [
    localStorage.getItem('loginId'),
    sessionStorage.getItem('loginId'),
    readCookie('loginId'),
  ].filter(Boolean)
  const loginId = sources[0] || ''
  const role = (
    localStorage.getItem('role') ||
    sessionStorage.getItem('role') ||
    readCookie('role') ||
    'MESSENGER' // ✅ default fallback
  ).toUpperCase()
  return { loginId, role }
}

const identity = ref(detectIdentity())

const devLoginId = ref('')
function useDevIdentity() {
  if (!devLoginId.value) return
  localStorage.setItem('loginId', devLoginId.value)
  localStorage.setItem('role', 'MESSENGER')
  identity.value = { loginId: devLoginId.value, role: 'MESSENGER' }
  loadList()
}

/* ───────── Columns ───────── */
const headers = [
  { title: 'Time', key: 'time', width: 160 },
  { title: 'Category', key: 'category', width: 120 },
  { title: 'Requester', key: 'requester', width: 230 },
  { title: 'Itinerary', key: 'itinerary' },
  { title: 'Pax', key: 'passengers', width: 70, align: 'center' },
  { title: 'Status', key: 'status', width: 150, align: 'end' },
  { title: 'Messenger Ack', key: 'messengerAck', width: 150, align: 'end' },
  { title: '', key: 'actions', sortable: false, width: 330, align: 'end' },
]

/* ───────── Icon + Color Maps ───────── */
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
const ackFa = s => ({
  PENDING:'fa-solid fa-circle-question',
  ACCEPTED:'fa-solid fa-thumbs-up',
  DECLINED:'fa-solid fa-thumbs-down'
}[s] || 'fa-solid fa-circle-question')

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination)
    .join(' → ')
}

/* ───────── Load List ───────── */
let leavePreviousRooms = null
async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    const params = { messengerId: loginId, role }
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value

    const { data } = await api.get('/messenger/car-bookings', {
      params: { messengerId: identity.value.loginId },
      headers: {
        'x-login-id': identity.value.loginId,
        'x-role': 'MESSENGER'
      }
    })

    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {}
    }))
    if (typeof leavePreviousRooms === 'function') await leavePreviousRooms()
    leavePreviousRooms = await subscribeBookingRooms(rows.value.map(r => r._id))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load bookings'
  } finally {
    loading.value = false
  }
}

async function updateStatus(item, newStatus) {
  if (!item?._id || actLoading.value) return
  actLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    await api.patch(`/messenger/car-bookings/${item._id}/status`,
      { status: newStatus },
      { headers: { 'x-login-id': loginId, 'x-role': role } })
    item.status = newStatus
    snackText.value = `Status updated → ${newStatus}`
    snack.value = true
  } catch (e) {
    snackText.value = e?.response?.data?.message || e?.message || 'Update failed'
    snack.value = true
  } finally {
    actLoading.value = ''
  }
}

function scrollToBooking(id) {
  // Wait for DOM to update
  setTimeout(() => {
    const el = document.querySelector(`[data-row-id="${id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-row')
      setTimeout(() => el.classList.remove('highlight-row'), 2000)
    }
  }, 300)
}



/* ───────── Filters + Helpers ───────── */
const filtered = computed(() =>
  (rows.value || [])
    .filter(r => {
      const term = qSearch.value.trim().toLowerCase()
      if (!term) return true
      const hay = [r.employee?.name, r.employeeId, prettyStops(r.stops)].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
)

/* ───────── Actions (acknowledge) ───────── */
const actLoading = ref('')
const snack = ref(false)
const snackText = ref('')

async function sendAck(item, response) {
  if (!item?._id || actLoading.value) return
  actLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId:'', role:'' }
    await api.post(`/messenger/car-bookings/${item._id}/ack`,
      { response },
      { headers: { 'x-login-id': loginId, 'x-role': role } })
    item.assignment = { ...(item.assignment || {}), messengerAck: response, messengerAckAt: new Date().toISOString() }
    snackText.value = response === 'ACCEPTED' ? 'Acknowledged.' : 'Declined.'
    snack.value = true
  } catch (e) {
    snackText.value = e?.response?.data?.message || e?.message || 'Action failed'
    snack.value = true
  } finally {
    actLoading.value = ''
  }
}

/* ───────── Lifecycle ───────── */
onMounted(() => {
  subscribeRoleIfNeeded({ role: 'MESSENGER' })
  if (focusDate.value) selectedDate.value = focusDate.value  // pre-filter by date
  loadList().then(() => {
    // highlight or scroll after data loads
    if (focusId.value) scrollToBooking(focusId.value)
  })
})

onBeforeUnmount(() => { if (typeof leavePreviousRooms === 'function') leavePreviousRooms() })
watch([selectedDate, statusFilter], loadList)
</script>

<template>
  <v-container fluid class="pa-2">
    <!-- Dev Identity Bar -->
    <v-alert
      v-if="!identity?.loginId"
      type="warning" variant="tonal" class="mb-2"
      title="Dev identity not detected"
      text="Enter your loginId (e.g., messenger01) to load assigned jobs."
    />
    <div v-if="!identity?.loginId" class="d-flex align-center mb-2" style="gap:8px;">
      <v-text-field v-model="devLoginId" label="loginId" density="compact" variant="outlined" hide-details style="max-width:220px" />
      <v-btn color="primary" size="small" @click="useDevIdentity">USE</v-btn>
    </div>

    <v-sheet class="messenger-section pa-0" rounded="lg">
      <div class="messenger-header">
        <div class="hdr-title"><i class="fa-solid fa-motorcycle"></i><span> Messenger Tasks</span></div>
        <v-btn size="small" :loading="loading" @click="loadList">
          <i class="fa-solid fa-rotate-right mr-1"></i> Refresh
        </v-btn>
      </div>

      <div class="px-3 pb-3 pt-2">
        <!-- Filters -->
        <v-card flat class="soft-card mb-3">
          <v-card-title class="subhdr"><i class="fa-solid fa-filter"></i><span>Filters</span></v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field v-model="selectedDate" type="date" label="Date (optional)" variant="outlined" density="compact" clearable />
              </v-col>
              <v-col cols="6" md="3">
                <v-select
                  :items="['ALL','PENDING','ASSIGNED','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED','DECLINED']"
                  v-model="statusFilter" label="Status" variant="outlined" density="compact" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="qSearch" label="Search requester / destination"
                              variant="outlined" density="compact" clearable>
                  <template #prepend-inner><i class="fa-solid fa-magnifying-glass"></i></template>
                </v-text-field>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <!-- Table -->
        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" border="start" class="mb-3">{{ error }}</v-alert>

            <v-data-table :headers="headers" :items="filtered" :loading="loading" density="comfortable" item-key="_id">
              <template #loading><v-skeleton-loader type="table-row@6" /></template>

              <template #item.time="{ item }">
                <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                <div class="text-caption">{{ item.tripDate }}</div>
              </template>

              <template #item.category>
                <v-chip color="deep-orange" size="small" label>
                  <i class="fa-solid fa-motorcycle mr-1"></i> Messenger
                </v-chip>
              </template>

              <template #item.requester="{ item }">
                <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                <div class="text-caption">{{ item.employee?.department || '—' }}</div>
              </template>

              <template #item.itinerary="{ item }">
                <div class="truncate-2">{{ prettyStops(item.stops) }}</div>
              </template>

              <template #item.passengers="{ item }">
                <div class="text-center">{{ item.passengers ?? 1 }}</div>
              </template>

              <template #item.status="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" label>
                  <i :class="statusFa(item.status)" class="mr-1"></i>{{ item.status }}
                </v-chip>
              </template>

              <template #item.messengerAck="{ item }">
                <v-chip :color="ackColor(item.assignment?.messengerAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(item.assignment?.messengerAck || 'PENDING')" class="mr-1"></i>
                  {{ item.assignment?.messengerAck || 'PENDING' }}
                </v-chip>
              </template>

              <template #item.actions="{ item }">
                <div :data-row-id="item._id" class="d-flex justify-end flex-wrap" style="gap:6px;">
                  <!-- ACK buttons (show only if still pending) -->
                  <template v-if="(item.assignment?.messengerAck || 'PENDING') === 'PENDING'">
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

                  <!-- Status updates (only after accepted) -->
                  <template v-else>
                    <v-menu>
                      <template #activator="{ props }">
                        <v-btn v-bind="props" color="primary" size="small" variant="flat">
                          <i class="fa-solid fa-route mr-1"></i> Update Status
                        </v-btn>
                      </template>
                      <v-list>
                        <v-list-item
                          v-for="s in ['ON_ROAD','ARRIVING','COMPLETED','DELAYED']"
                          :key="s"
                          @click="updateStatus(item, s)">
                          <v-list-item-title>{{ s }}</v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-menu>
                  </template>
                </div>
              </template>


              <template #no-data>
                <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
                  No messenger bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
                </v-sheet>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </div>
    </v-sheet>

    <v-snackbar v-model="snack" timeout="2000" location="bottom right">{{ snackText }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.highlight-row {
  animation: flash 0.8s ease-in-out 3;
  outline: 3px solid #4f46e5;
  background-color: #eef2ff !important;
}
@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.messenger-section { border: 1px solid #e6e8ee; background:#fff; border-radius: 12px; }
.messenger-header { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background:#fff7f3; border-bottom: 1px solid #e6e8ee; }
.hdr-title { display:flex; align-items:center; gap:10px; font-weight:800; color:#3b1e10; }
.soft-card { border: 1px solid #e9ecf3; border-radius: 12px; background:#fff; }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:800; color:#3b1e10; }
.elevated { border: 1px solid #e9ecf3; border-radius: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }z
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.mr-1 { margin-right: .25rem; } .mr-2 { margin-right: .5rem; }
.ml-2 { margin-left: .5rem; }
</style>
