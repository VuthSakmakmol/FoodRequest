<!-- src/views/driver/DriverCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'
import { useRoute } from 'vue-router'

/* ─────────────── STATE ─────────────── */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const route = useRoute()

const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch      = ref('')

/* Khmer status options for filter (values still English for backend) */
const statusOptions = [
  { label: 'ទាំងអស់', value: 'ALL' },
  { label: 'កំពុងរង់ចាំ', value: 'PENDING' },
  { label: 'បានចាត់ចែង', value: 'ASSIGNED' },
  { label: 'បានព្រមទទួល', value: 'ACCEPTED' },
  { label: 'កំពុងធ្វើដំណើរ', value: 'ON_ROAD' },
  { label: 'ជិតដល់គោលដៅ', value: 'ARRIVING' },
  { label: 'បានបញ្ចប់', value: 'COMPLETED' },
  { label: 'យឺតយ៉ាវ', value: 'DELAYED' },
  { label: 'បានបោះបង់', value: 'CANCELLED' },
  { label: 'បដិសេធ', value: 'DECLINED' },
]

/* ─────────────── IDENTITY DETECTION ─────────────── */
function readCookie(name) {
  const m = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
  )
  return m ? decodeURIComponent(m[1]) : ''
}

function detectIdentity() {
  const found = []
  const tryParse = src => {
    try {
      const u = JSON.parse(localStorage.getItem(src) || sessionStorage.getItem(src) || '{}')
      if (u?.loginId || u?.user?.loginId)
        found.push({
          loginId: String(u.loginId || u?.user?.loginId),
          role: String(u.role || u?.user?.role || '').toUpperCase(),
        })
    } catch {}
  }

  tryParse('auth:user')
  const lsLogin = localStorage.getItem('loginId')
  const lsRole = (localStorage.getItem('role') || '').toUpperCase()
  if (lsLogin || lsRole) found.push({ loginId: String(lsLogin || ''), role: lsRole })

  const ssLogin = sessionStorage.getItem('loginId')
  const ssRole = (sessionStorage.getItem('role') || '').toUpperCase()
  if (ssLogin || ssRole) found.push({ loginId: String(ssLogin || ''), role: ssRole })

  const ckLogin = readCookie('loginId')
  const ckRole = (readCookie('role') || '').toUpperCase()
  if (ckLogin || ckRole) found.push({ loginId: String(ckLogin || ''), role: ckRole })

  for (let i = 0; i < localStorage.length; i++) {
    try {
      const v = JSON.parse(localStorage.getItem(localStorage.key(i)) || 'null')
      const candLogin = v?.loginId || v?.user?.loginId || v?.me?.loginId
      const candRole = (v?.role || v?.user?.role || v?.me?.role || '').toUpperCase()
      if (candLogin && candRole) {
        found.push({ loginId: String(candLogin), role: candRole })
        break
      }
    } catch {}
  }
  return found.find(x => x.loginId) || { loginId: '', role: '' }
}

const identity = ref(detectIdentity())

/* Dev override bar */
const devLoginId = ref('')
const devRole = ref('DRIVER')
function useDevIdentity() {
  if (!devLoginId.value) return
  localStorage.setItem('loginId', devLoginId.value)
  localStorage.setItem('role', devRole.value)
  identity.value = { loginId: devLoginId.value, role: devRole.value }
  loadList()
}

/* ─────────────── LABEL MAPS (KH) ─────────────── */
const STATUS_LABEL_KM = {
  PENDING : 'កំពុងរង់ចាំ',
  ASSIGNED: 'បានចាត់ចែង',
  ACCEPTED: 'បានព្រមទទួល',
  ON_ROAD : 'កំពុងធ្វើដំណើរ',
  ARRIVING: 'ជិតដល់គោលដៅ',
  COMPLETED: 'បានបញ្ចប់',
  DELAYED : 'យឺតយ៉ាវ',
  CANCELLED: 'បានបោះបង់',
  DECLINED: 'បដិសេធ',
}

const ACK_LABEL_KM = {
  PENDING : 'មិនទាន់ឆ្លើយ',
  ACCEPTED: 'ព្រមទទួល',
  DECLINED: 'បដិសេធ',
}

const CATEGORY_LABEL_KM = {
  Car  : 'ឡាន',
  Motor: 'ម៉ូតូ',
}

const statusLabel = s => STATUS_LABEL_KM[String(s || '').toUpperCase()] || s
const ackLabel    = s => ACK_LABEL_KM[String(s || '').toUpperCase()] || s
const categoryLabel = c => CATEGORY_LABEL_KM[c] || c

/* ─────────────── TABLE HEADERS ─────────────── */
const roleLabel = computed(() =>
  identity.value?.role === 'MESSENGER'
    ? 'អ្នកបើកម៉ូតូ'
    : 'អ្នកបើកឡាន'
)
const headers = computed(() => [
  { title: 'ម៉ោង',           key: 'time',       width: 160 },
  { title: 'ប្រភេទ',         key: 'category',   width: 120 },
  { title: 'អ្នកស្នើសុំ',    key: 'requester',  width: 230 },
  { title: 'ផ្លូវដំណើរ',     key: 'itinerary' },
  { title: 'អ្នកដំណើរ',      key: 'passengers', width: 70,  align: 'center' },
  { title: 'ស្ថានភាព',      key: 'status',     width: 150, align: 'end' },
  { title: roleLabel.value,   key: 'driverAck',  width: 150, align: 'end' },
  { title: '',                key: 'actions',    width: 330, align: 'end' },
])

/* ─────────────── ICONS / COLORS ─────────────── */
const statusColor = s =>
  ({
    PENDING: 'grey',
    ACCEPTED: 'primary',
    ON_ROAD: 'info',
    ARRIVING: 'teal',
    COMPLETED: 'success',
    DELAYED: 'warning',
    CANCELLED: 'error',
    DECLINED: 'error',
    ASSIGNED: 'primary',
  }[s] || 'grey')

const statusFa = s =>
  ({
    PENDING: 'fa-solid fa-hourglass-half',
    ACCEPTED: 'fa-solid fa-circle-check',
    ON_ROAD: 'fa-solid fa-truck-fast',
    ARRIVING: 'fa-solid fa-flag-checkered',
    COMPLETED: 'fa-solid fa-check-double',
    DELAYED: 'fa-solid fa-triangle-exclamation',
    CANCELLED: 'fa-solid fa-ban',
    DECLINED: 'fa-solid fa-circle-xmark',
    ASSIGNED: 'fa-solid fa-user-tag',
  }[s] || 'fa-solid fa-hourglass-half')

const ackColor = s => ({ PENDING: 'grey', ACCEPTED: 'success', DECLINED: 'error' }[s] || 'grey')
const ackFa = s =>
  ({
    PENDING: 'fa-solid fa-circle-question',
    ACCEPTED: 'fa-solid fa-thumbs-up',
    DECLINED: 'fa-solid fa-thumbs-down',
  }[s] || 'fa-solid fa-circle-question')

/* destination text helper (English names from DB, but formatted clearly) */
function destText(s = {}) {
  return s.destination === 'Other'
    ? s.destinationOther || 'Other'
    : s.destination
}

/* Khmer-friendly multi-stop display */
function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map((s, i) => `#${i + 1}: ${destText(s)}`)
    .join(' • ')
}

function absUrl(u) {
  const base = (api.defaults.baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '')
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`
}

/* ─────────────── LOAD BOOKINGS ─────────────── */
let leavePreviousRooms = null
async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const { loginId, role } = identity.value || { loginId: '', role: '' }
    const isMessenger = role === 'MESSENGER'
    const basePath = isMessenger ? '/messenger/car-bookings' : '/driver/car-bookings'
    const params = { role, loginId }
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value

    const { data } = await api.get(basePath, {
      params,
      headers: { 'x-login-id': loginId || '', 'x-role': role || '' },
    })

    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {},
    }))

    const ids = rows.value.map(r => String(r._id)).filter(Boolean)
    if (typeof leavePreviousRooms === 'function') {
      await leavePreviousRooms()
      leavePreviousRooms = null
    }
    leavePreviousRooms = await subscribeBookingRooms(ids)
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'មិនអាចផ្ទុកទិន្នន័យបាន'
  } finally {
    loading.value = false
  }
}

/* ─────────────── FILTERED / SORTED ─────────────── */
const filtered = computed(() =>
  (rows.value || [])
    .filter(r => {
      const term = qSearch.value.trim().toLowerCase()
      if (!term) return true
      const hay = [
        r.employee?.name,
        r.employee?.department,
        r.employeeId,
        r.purpose,
        r.notes,
        prettyStops(r.stops),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(term)
    })
    .sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
)

/* ─────────────── SIMPLE PAGINATION ─────────────── */
const page = ref(1)
const itemsPerPage = 10

const pageCount = computed(() => {
  const n = Math.ceil((filtered.value?.length || 0) / itemsPerPage)
  return Math.max(1, n || 1)
})
const totalItems = computed(() => filtered.value?.length || 0)
const rangeStart = computed(() =>
  totalItems.value ? (page.value - 1) * itemsPerPage + 1 : 0
)
const rangeEnd = computed(() =>
  Math.min(page.value * itemsPerPage, totalItems.value)
)

watch(filtered, () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

/* ─────────────── ACTION HELPERS ─────────────── */
const isMine = it =>
  String(
    it?.assignment?.driverId || it?.assignment?.messengerId || it?.driverId || ''
  ).toLowerCase() === String(identity.value?.loginId || '').toLowerCase()

const canRespond = it => {
  const ack =
    identity.value?.role === 'MESSENGER'
      ? String(it?.assignment?.messengerAck || '').toUpperCase()
      : String(it?.assignment?.driverAck || '').toUpperCase()
  return isMine(it) && !['ACCEPTED', 'DECLINED'].includes(ack)
}

const terminalStates = ['CANCELLED', 'COMPLETED']
// 🚫 remove CANCELLED from allowed next statuses (driver cannot cancel)
const ALLOWED_NEXT = {
  ACCEPTED: ['ON_ROAD', 'DELAYED'],
  ON_ROAD: ['ARRIVING', 'DELAYED'],
  ARRIVING: ['COMPLETED', 'DELAYED'],
  DELAYED: ['ON_ROAD', 'ARRIVING'],
}
const nextStatusesFor = from => ALLOWED_NEXT[String(from || '').toUpperCase()] || []

const canChangeStatus = it =>
  isMine(it) &&
  ((it?.assignment?.driverAck || it?.assignment?.messengerAck) === 'ACCEPTED') &&
  !terminalStates.includes(String(it?.status || '').toUpperCase())

/* ─────────────── ACTIONS ─────────────── */
const actLoading = ref('')
const statusLoading = ref('')
const snack = ref(false)
const snackText = ref('')

async function sendAck(item, response) {
  if (!item?._id || actLoading.value) return
  actLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId: '', role: '' }
    const isMessenger = role === 'MESSENGER'
    const path = isMessenger
      ? `/messenger/car-bookings/${item._id}/ack`
      : `/driver/car-bookings/${item._id}/ack`

    await api.post(path, { response }, { headers: { 'x-login-id': loginId, 'x-role': role } })
    if (isMessenger)
      item.assignment = { ...item.assignment, messengerAck: response, messengerAckAt: new Date() }
    else item.assignment = { ...item.assignment, driverAck: response, driverAckAt: new Date() }

    snackText.value = response === 'ACCEPTED'
      ? 'អ្នកបានព្រមទទួលភារកិច្ចនេះ។'
      : 'បានកត់ត្រាការឆ្លើយតបរួចរាល់។'
    snack.value = true
  } catch (e) {
    snackText.value = e?.response?.data?.message || e?.message || 'សកម្មភាពបរាជ័យ'
    snack.value = true
  } finally {
    actLoading.value = ''
  }
}

async function setDriverStatus(item, nextStatus) {
  if (!item?._id || statusLoading.value) return
  statusLoading.value = String(item._id)
  try {
    const { loginId, role } = identity.value || { loginId: '', role: '' }
    const path =
      role === 'MESSENGER'
        ? `/messenger/car-bookings/${item._id}/status`
        : `/driver/car-bookings/${item._id}/status`
    await api.patch(path, { status: nextStatus }, { headers: { 'x-login-id': loginId, 'x-role': role } })
    item.status = nextStatus
    snackText.value = `បានធ្វើបច្ចុប្បន្នភាពស្ថានភាពទៅ ${statusLabel(nextStatus)}។`
    snack.value = true
  } catch (e) {
    await loadList()
    snackText.value = e?.response?.data?.message || e?.message || 'មិនអាចបច្ចុប្បន្នភាពស្ថានភាពបាន'
    snack.value = true
  } finally {
    statusLoading.value = ''
  }
}

/* ─────────────── SOCKET HANDLERS ─────────────── */
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}
function onAssigned(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) {
    it.assignment = {
      ...it.assignment,
      driverId: p.driverId,
      driverName: p.driverName,
      messengerId: p.messengerId,
      messengerName: p.messengerName,
    }
  }
}
function onAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return
  if (p.response)
    it.assignment = {
      ...it.assignment,
      driverAck: p.response,
      messengerAck: p.response,
    }
}

/* ─────────────── LIFECYCLE ─────────────── */
onMounted(() => {
  subscribeRoleIfNeeded(identity.value)
  if (route.query?.date) {
    selectedDate.value = String(route.query.date)
  }

  watch(rows, () => {
    const focusId = route.query?.focus
    if (focusId) {
      const el = document.querySelector(`[data-id="${focusId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('highlighted')
        setTimeout(() => el.classList.remove('highlighted'), 2500)
      }
    }
  })

  loadList()
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', onAssigned)
  socket.on('carBooking:driverAck', onAck)
  socket.on('carBooking:messengerAck', onAck)
})
onBeforeUnmount(() => {
  socket.off('carBooking:status', onStatus)
  socket.off('carBooking:assigned', onAssigned)
  socket.off('carBooking:driverAck', onAck)
  socket.off('carBooking:messengerAck', onAck)
  if (typeof leavePreviousRooms === 'function') leavePreviousRooms()
})
watch([selectedDate, statusFilter], loadList)

const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item) {
  detailItem.value = item
  detailOpen.value = true
}
</script>

<template>
  <v-container fluid class="pa-2">
    <!-- identity bar (dev only) -->
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
            <span>បញ្ជីការកក់រថយន្ត</span>
          </div>
        </div>
        <div class="hdr-actions">
          <v-btn size="small" :loading="loading" @click="loadList">
            <i class="fa-solid fa-rotate-right mr-1"></i> ផ្ទុកឡើងវិញ
          </v-btn>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <!-- Filters -->
        <v-card flat class="soft-card mb-3">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>តម្រង</span>
            <v-spacer />
          </v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="selectedDate"
                  type="date"
                  label="កាលបរិច្ឆេទ (ស្រេចចិត្ត)"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                />
              </v-col>
              <v-col cols="6" md="3">
                <v-select
                  :items="statusOptions"
                  v-model="statusFilter"
                  item-title="label"
                  item-value="value"
                  label="ស្ថានភាព"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="qSearch"
                  label="ស្វែងរកអ្នកស្នើសុំ / គោលបំណង / ទីតាំង"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                >
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

            <v-data-table
              :headers="headers"
              :items="filtered"
              :loading="loading"
              item-key="_id"
              density="comfortable"
              class="elevated"
              v-model:page="page"
              :items-per-page="itemsPerPage"
              :hide-default-footer="true"
            >
              <template #loading><v-skeleton-loader type="table-row@6" /></template>

              <template #item.time="{ item }">
                <div :data-id="item._id">
                  <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                  <div class="text-caption text-medium-emphasis">{{ item.tripDate }}</div>
                </div>
              </template>

              <template #item.category="{ item }">
                <v-chip :color="item.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
                  <i class="fa-solid" :class="item.category === 'Car' ? 'fa-car' : 'fa-motorcycle'"></i>
                  <span class="ml-2">{{ categoryLabel(item.category) }}</span>
                </v-chip>
              </template>

              <template #item.requester="{ item }">
                <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                </div>
              </template>

              <template #item.itinerary="{ item }">
                <div class="truncate-2">
                  <span class="text-medium-emphasis">គោលដៅ៖ </span>
                  {{ prettyStops(item.stops) }}
                </div>
                <div class="mt-1" v-if="item.ticketUrl">
                  <a :href="absUrl(item.ticketUrl)" target="_blank" rel="noopener" class="text-decoration-none">
                    <v-btn size="x-small" color="indigo" variant="tonal">
                      <i class="fa-solid fa-paperclip mr-1"></i> សំបុត្រ
                    </v-btn>
                  </a>
                </div>
              </template>

              <template #item.passengers="{ item }">
                <div class="text-center">{{ item.passengers ?? 1 }}</div>
              </template>

              <template #item.status="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" label>
                  <i :class="statusFa(item.status)" class="mr-1"></i> {{ statusLabel(item.status) }}
                </v-chip>
              </template>

              <template #item.driverAck="{ item }">
                <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(item.assignment?.driverAck || 'PENDING')" class="mr-1"></i>
                  {{ ackLabel(item.assignment?.driverAck || 'PENDING') }}
                </v-chip>
              </template>

              <!-- ACTIONS -->
              <template #item.actions="{ item }">
                <div class="d-flex justify-end" style="gap:6px; flex-wrap: wrap;">
                  <!-- Step 1: driver/messenger ack (NO DECLINE) -->
                  <template v-if="canRespond(item)">
                    <v-btn
                      size="small"
                      color="success"
                      variant="flat"
                      :loading="actLoading === String(item._id)"
                      @click.stop="sendAck(item,'ACCEPTED')"
                    >
                      <i class="fa-solid fa-check mr-1"></i> យល់ព្រម
                    </v-btn>
                  </template>

                  <!-- Step 2: live status (after ack ACCEPTED) – no CANCELLED -->
                  <template v-if="canChangeStatus(item)">
                    <v-menu location="bottom end">
                      <template #activator="{ props }">
                        <v-btn
                          v-bind="props"
                          size="small"
                          variant="tonal"
                          color="primary"
                          :loading="statusLoading === String(item._id)"
                        >
                          <i class="fa-solid fa-arrows-rotate mr-2"></i> បន្ទាន់សម័យស្ថានភាព
                        </v-btn>
                      </template>
                      <v-list density="compact" min-width="220">
                        <v-list-subheader>ស្ថានភាពបន្ទាប់</v-list-subheader>
                        <v-list-item
                          v-for="s in nextStatusesFor(item.status)"
                          :key="s"
                          @click.stop="setDriverStatus(item, s)"
                        >
                          <template #prepend><i :class="statusFa(s)"></i></template>
                          <v-list-item-title>{{ statusLabel(s) }}</v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-menu>
                  </template>

                  <v-btn size="small" variant="tonal" color="primary" @click.stop="showDetails(item)">
                    <i class="fa-solid fa-circle-info mr-1"></i> ព័ត៌មានលម្អិត
                  </v-btn>
                </div>
              </template>

              <template #no-data>
                <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
                  មិនមានការកក់រថយន្តទេ<span v-if="selectedDate"> នៅថ្ងៃទី {{ selectedDate }}</span>។
                </v-sheet>
              </template>

              <!-- Custom footer: only next/prev icons, no "items per page" select -->
              <template #bottom>
                <div class="table-footer">
                  <div class="tf-left text-caption text-medium-emphasis">
                    {{ rangeStart }}–{{ rangeEnd }} នៃ {{ totalItems }}
                  </div>
                  <div class="tf-right">
                    <v-pagination
                      v-model="page"
                      :length="pageCount"
                      :total-visible="5"
                      density="comfortable"
                    >
                      <template #first>
                        <i class="fa-solid fa-angles-left"></i>
                      </template>
                      <template #prev>
                        <i class="fa-solid fa-angle-left" style="margin-top: 10px;"></i>
                      </template>
                      <template #next>
                        <i class="fa-solid fa-angle-right" style="margin-top: 10px;"></i>
                      </template>
                      <template #last>
                        <i class="fa-solid fa-angles-right"></i>
                      </template>
                    </v-pagination>
                  </div>
                </div>
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
              <span class="ml-2">{{ categoryLabel(detailItem?.category || '') || '—' }}</span>
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
            <v-col cols="12" md="6">
              <div class="lbl">កាលបរិច្ឆេទ</div>
              <div class="val">{{ detailItem?.tripDate || '—' }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="lbl">អ្នកដំណើរ</div>
              <div class="val">{{ detailItem?.passengers ?? 1 }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="lbl">អ្នកស្នើសុំ</div>
              <div class="val">
                {{ detailItem?.employee?.name || '—' }}
                <div class="text-caption text-medium-emphasis">
                  {{ detailItem?.employee?.department || '—' }} • ID {{ detailItem?.employeeId }}
                </div>
              </div>
            </v-col>
            <v-col cols="12">
              <div class="lbl">ផ្លូវដំណើរ / គោលដៅ</div>
              <div class="val">
                <div v-if="(detailItem?.stops || []).length" class="stops">
                  <div v-for="(s,i) in detailItem.stops" :key="i" class="stop">
                    <i
                      :class="s.destination === 'Airport' ? 'fa-solid fa-plane' : 'fa-solid fa-location-dot'"
                      class="mr-1"
                    ></i>
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ destText(s) }}</span>
                    <a
                      v-if="s.mapLink"
                      :href="absUrl(s.mapLink)"
                      target="_blank"
                      rel="noopener"
                      class="ml-2 text-decoration-none"
                    >
                      <v-btn size="x-small" variant="text" color="primary">
                        <i class="fa-solid fa-link mr-1"></i> ផែនទី
                      </v-btn>
                    </a>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">ស្ថានភាព</div>
              <div class="val">
                <v-chip :color="statusColor(detailItem?.status)" size="small" label>
                  <i :class="statusFa(detailItem?.status)" class="mr-1"></i>
                  {{ statusLabel(detailItem?.status || '—') }}
                </v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">ការឆ្លើយតបអ្នកបើកបរ</div>
              <div class="val">
                <v-chip :color="ackColor(detailItem?.assignment?.driverAck || 'PENDING')" size="small" label>
                  <i :class="ackFa(detailItem?.assignment?.driverAck || 'PENDING')" class="mr-1"></i>
                  {{ ackLabel(detailItem?.assignment?.driverAck || 'PENDING') }}
                </v-chip>
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end" style="gap:8px;">
          <template v-if="detailItem && canRespond(detailItem)">
            <!-- Driver can only accept here too -->
            <v-btn
              size="small"
              color="success"
              variant="flat"
              :loading="actLoading === String(detailItem?._id)"
              @click="sendAck(detailItem,'ACCEPTED')"
            >
              <i class="fa-solid fa-check mr-1"></i> យល់ព្រម
            </v-btn>
          </template>
          <template v-if="detailItem && canChangeStatus(detailItem)">
            <v-menu location="bottom end">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  size="small"
                  variant="tonal"
                  color="primary"
                  :loading="statusLoading === String(detailItem?._id)"
                >
                  <i class="fa-solid fa-arrows-rotate mr-2"></i> បន្ទាន់សម័យស្ថានភាព
                </v-btn>
              </template>
              <v-list density="compact" min-width="220">
                <v-list-subheader>ស្ថានភាពបន្ទាប់</v-list-subheader>
                <v-list-item
                  v-for="s in nextStatusesFor(detailItem.status)"
                  :key="s"
                  @click.stop="setDriverStatus(detailItem, s)"
                >
                  <template #prepend><i :class="statusFa(s)"></i></template>
                  <v-list-item-title>{{ statusLabel(s) }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </template>
          <v-btn variant="text" @click="detailOpen = false">បិទ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack" timeout="2200" location="bottom right">
      {{ snackText }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.highlighted {
  animation: flashHighlight 2s ease-in-out;
  background: #e0f2fe !important;
}
@keyframes flashHighlight {
  0% { background: #e0f2fe; }
  100% { background: transparent; }
}

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

/* custom footer */
.table-footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding: 10px 16px;
  border-top: 1px solid #e5e7eb;
}
.tf-left { min-width: 120px; }
.tf-right { display:flex; align-items:center; }

/* tighter pagination buttons */
:deep(.v-pagination .v-btn){ min-width: 32px; }
:deep(.v-pagination .v-btn i.fa-solid){ line-height: 1; }

@media (max-width: 600px){
  .table-footer { flex-direction: column; align-items:flex-start; }
}
</style>
