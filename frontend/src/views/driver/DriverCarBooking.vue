<!-- src/views/driver/DriverCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

/* ─────────────── STATE ─────────────── */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const route = useRoute()

const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch      = ref('')

/* responsive */
const { smAndDown } = useDisplay()
const isMobile = computed(() => smAndDown.value)

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
  try { subscribeRoleIfNeeded({ role: devRole.value }) } catch {}
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

const statusLabel   = s => STATUS_LABEL_KM[String(s || '').toUpperCase()] || s
const ackLabel      = s => ACK_LABEL_KM[String(s || '').toUpperCase()] || s
const categoryLabel = c => CATEGORY_LABEL_KM[c] || c

/* ─────────────── TABLE HEADERS ─────────────── */
const roleLabel = computed(() =>
  identity.value?.role === 'MESSENGER'
    ? 'អ្នកបើកម៉ូតូ'
    : 'អ្នកបើកឡាន'
)
const headers = computed(() => [
  { title: 'ម៉ោង',           key: 'time',        width: 160 },
  { title: 'ប្រភេទ',         key: 'category',    width: 120 },
  { title: 'អ្នកស្នើសុំ',    key: 'requester',   width: 230 },
  { title: 'គោលដៅ',         key: 'destination' },
  { title: 'អ្នកដំណើរ',      key: 'passengers',  width: 70,  align: 'center' },
  { title: 'ស្ថានភាព',      key: 'status',      width: 150, align: 'end' },
  { title: roleLabel.value,   key: 'driverAck',   width: 150, align: 'end' },
  { title: '',                key: 'actions',     width: 330, align: 'end' },
])

/* ─────────────── ICONS / COLORS (MDI) ─────────────── */
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

const statusIcon = s =>
  ({
    PENDING:   'mdi-timer-sand',
    ACCEPTED:  'mdi-check-circle-outline',
    ON_ROAD:   'mdi-truck-fast',
    ARRIVING:  'mdi-flag-checkered',
    COMPLETED: 'mdi-check-all',
    DELAYED:   'mdi-alert-outline',
    CANCELLED: 'mdi-cancel',
    DECLINED:  'mdi-close-circle-outline',
    ASSIGNED:  'mdi-account-badge',
  }[s] || 'mdi-timer-sand')

const ackColor = s => ({ PENDING: 'grey', ACCEPTED: 'success', DECLINED: 'error' }[s] || 'grey')
const ackIcon = s =>
  ({
    PENDING:  'mdi-help-circle-outline',
    ACCEPTED: 'mdi-thumb-up-outline',
    DECLINED: 'mdi-thumb-down-outline',
  }[s] || 'mdi-help-circle-outline')

/* destination text helper */
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

/* ─────────────── SIMPLE PAGINATION (shared for table + cards) ─────────────── */
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

const paged = computed(() => {
  const start = (page.value - 1) * itemsPerPage
  return filtered.value.slice(start, start + itemsPerPage)
})

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

    await api.patch(
      path,
      { status: nextStatus },
      { headers: { 'x-login-id': loginId, 'x-role': role } }
    )

    item.status = nextStatus

    snackText.value = `បានធ្វើបច្ចុប្បន្នភាពស្ថានភាពទៅ ${statusLabel(nextStatus)}។`
    snack.value = true
  } catch (e) {
    await loadList()
    snackText.value =
      e?.response?.data?.message ||
      e?.message ||
      'មិនអាចបច្ចុប្បន្នភាពស្ថានភាពបាន'
    snack.value = true
  } finally {
    statusLoading.value = ''
  }
}

/* ─────────────── SOCKET HANDLERS ─────────────── */
function onCreated(doc) {
  if (!doc?._id) return

  const myLogin = (identity.value?.loginId || '').toLowerCase()
  const driverId    = String(doc?.assignment?.driverId || doc?.driverId || '').toLowerCase()
  const messengerId = String(doc?.assignment?.messengerId || doc?.messengerId || '').toLowerCase()
  const mine = myLogin && (driverId === myLogin || messengerId === myLogin)
  if (!mine) return

  const tripDate = doc.tripDate || doc.date
  if (selectedDate.value && tripDate !== selectedDate.value) return

  const status = String(doc.status || '').toUpperCase()
  if (statusFilter.value !== 'ALL' && status !== statusFilter.value) return

  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) {
    rows.value.push({
      ...doc,
      stops: doc.stops || [],
      assignment: doc.assignment || {},
    })
  }
}

function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it && p?.status) it.status = p.status
}

async function onAssigned(p) {
  const bookingId = String(p?.bookingId || '')
  if (!bookingId) return

  const it = rows.value.find(x => String(x._id) === bookingId)

  const myLogin = (identity.value?.loginId || '').toLowerCase()
  const mine =
    String(p?.driverId || '').toLowerCase() === myLogin ||
    String(p?.messengerId || '').toLowerCase() === myLogin

  if (it) {
    it.assignment = {
      ...(it.assignment || {}),
      driverId: p.driverId ?? it.assignment?.driverId ?? '',
      driverName: p.driverName ?? it.assignment?.driverName ?? '',
      messengerId: p.messengerId ?? it.assignment?.messengerId ?? '',
      messengerName: p.messengerName ?? it.assignment?.messengerName ?? '',
    }
    if (p.status) it.status = p.status
  } else if (mine) {
    await loadList()
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
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', onAssigned)
  socket.on('carBooking:driverAck', onAck)
  socket.on('carBooking:messengerAck', onAck)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
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
      <v-text-field
        v-model="devLoginId"
        label="loginId"
        density="compact"
        variant="outlined"
        style="max-width:220px;"
        hide-details
      />
      <v-select
        :items="['DRIVER','MESSENGER']"
        v-model="devRole"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width:160px;"
      />
      <v-btn color="primary" size="small" @click="useDevIdentity">USE</v-btn>
    </div>

    <v-sheet class="driver-section pa-0" rounded="lg">
      <!-- HERO FILTER BAR -->
      <div class="driver-hero">
        <v-text-field
          v-model="selectedDate"
          type="date"
          label="កាលបរិច្ឆេទ"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="fh-field fh-date"
        />
        <v-select
          :items="statusOptions"
          v-model="statusFilter"
          item-title="label"
          item-value="value"
          label="ស្ថានភាព"
          variant="outlined"
          density="compact"
          hide-details
          class="fh-field fh-status"
        />
        <v-text-field
          v-model="qSearch"
          label="ស្វែងរកអ្នកស្នើសុំ / គោលបំណង / ទីតាំង"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="fh-field fh-search"
        >
          <template #prepend-inner>
            <v-icon icon="mdi-magnify" size="16" />
          </template>
        </v-text-field>
      </div>

      <div class="px-3 pb-3 pt-3">
        <v-card flat class="soft-card">
          <v-card-text>
            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              border="start"
              class="mb-3"
            >
              {{ error }}
            </v-alert>

            <!-- MOBILE: CARD LIST -->
            <div v-if="isMobile" class="driver-card-wrap">
              <v-skeleton-loader
                v-if="loading"
                type="card@3"
                class="mb-2"
              />
              <template v-else>
                <div v-if="!filtered.length" class="no-data-mobile text-center py-6 text-medium-emphasis">
                  មិនមានការកក់រថយន្តទេ
                  <span v-if="selectedDate"> នៅថ្ងៃទី {{ selectedDate }}</span>។
                </div>

                <div v-else class="driver-card-list">
                  <v-card
                    v-for="item in paged"
                    :key="item._id"
                    class="driver-card"
                    rounded="xl"
                    elevation="2"
                    :data-id="item._id"
                  >
                    <v-card-text class="py-3 px-3">
                      <!-- top row: category + time + status -->
                      <div class="card-top">
                        <div class="card-top-left">
                          <v-chip
                            :color="item.category === 'Car' ? 'indigo' : 'deep-orange'"
                            size="small"
                            label
                            class="mb-1"
                          >
                            <v-icon
                              :icon="item.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'"
                              size="16"
                            />
                            <span class="ml-2">{{ categoryLabel(item.category) }}</span>
                          </v-chip>
                          <div class="card-time mono">
                            {{ item.timeStart }} – {{ item.timeEnd }}
                          </div>
                          <div class="card-date text-caption text-medium-emphasis">
                            {{ item.tripDate }}
                          </div>
                        </div>
                        <div class="card-top-right">
                          <v-chip :color="statusColor(item.status)" size="small" label>
                            <v-icon :icon="statusIcon(item.status)" size="16" class="mr-1" />
                            {{ statusLabel(item.status) }}
                          </v-chip>
                        </div>
                      </div>

                      <v-divider class="my-2" />

                      <!-- requester -->
                      <div class="card-row">
                        <div class="lbl">អ្នកស្នើសុំ</div>
                        <div class="val">
                          {{ item.employee?.name || '—' }}
                          <div class="text-caption text-medium-emphasis">
                            {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                          </div>
                        </div>
                      </div>

                      <!-- destination -->
                      <div class="card-row">
                        <div class="lbl">គោលដៅ</div>
                        <div class="val">
                          <div class="truncate-2">
                            {{ prettyStops(item.stops) }}
                          </div>
                          <div class="mt-1" v-if="item.ticketUrl">
                            <a
                              :href="absUrl(item.ticketUrl)"
                              target="_blank"
                              rel="noopener"
                              class="text-decoration-none"
                            >
                              <v-btn size="x-small" color="indigo" variant="tonal">
                                <v-icon icon="mdi-paperclip" size="14" class="mr-1" /> សំបុត្រ
                              </v-btn>
                            </a>
                          </div>
                        </div>
                      </div>

                      <!-- passengers + ack -->
                      <div class="card-row small">
                        <div class="lbl">អ្នកដំណើរ</div>
                        <div class="val">{{ item.passengers ?? 1 }}</div>
                      </div>

                      <div class="card-row small">
                        <div class="lbl">{{ roleLabel }}</div>
                        <div class="val">
                          <v-chip
                            :color="ackColor(item.assignment?.driverAck || 'PENDING')"
                            size="small"
                            label
                          >
                            <v-icon
                              :icon="ackIcon(item.assignment?.driverAck || 'PENDING')"
                              size="16"
                              class="mr-1"
                            />
                            {{ ackLabel(item.assignment?.driverAck || 'PENDING') }}
                          </v-chip>
                        </div>
                      </div>

                      <!-- purpose / notes -->
                      <div class="card-row" v-if="item.purpose">
                        <div class="lbl">គោលបំណង</div>
                        <div class="val">{{ item.purpose }}</div>
                      </div>
                      <div class="card-row" v-if="item.notes">
                        <div class="lbl">ចំណាំ</div>
                        <div class="val notes-val">{{ item.notes }}</div>
                      </div>

                      <!-- actions -->
                      <div class="card-actions-row">
                        <v-btn
                          v-if="canRespond(item)"
                          block
                          size="small"
                          color="success"
                          variant="flat"
                          :loading="actLoading === String(item._id)"
                          class="mb-1"
                          @click.stop="sendAck(item,'ACCEPTED')"
                        >
                          <v-icon icon="mdi-check" size="16" class="mr-1" /> យល់ព្រម
                        </v-btn>

                        <v-menu
                          v-if="canChangeStatus(item)"
                          location="bottom end"
                        >
                          <template #activator="{ props }">
                            <v-btn
                              v-bind="props"
                              block
                              size="small"
                              variant="tonal"
                              color="primary"
                              class="mb-1"
                              :loading="statusLoading === String(item._id)"
                            >
                              <v-icon icon="mdi-sync" size="16" class="mr-2" />
                              បន្ទាន់សម័យស្ថានភាព
                            </v-btn>
                          </template>
                          <v-list density="compact" min-width="220">
                            <v-list-subheader>ស្ថានភាពបន្ទាប់</v-list-subheader>
                            <v-list-item
                              v-for="s in nextStatusesFor(item.status)"
                              :key="s"
                              @click.stop="setDriverStatus(item, s)"
                            >
                              <template #prepend>
                                <v-icon :icon="statusIcon(s)" size="18" />
                              </template>
                              <v-list-item-title>{{ statusLabel(s) }}</v-list-item-title>
                            </v-list-item>
                          </v-list>
                        </v-menu>

                        <v-btn
                          block
                          size="small"
                          variant="text"
                          color="primary"
                          @click.stop="showDetails(item)"
                        >
                          <v-icon icon="mdi-information" size="16" class="mr-1" />
                          ព័ត៌មានលម្អិត
                        </v-btn>
                      </div>
                    </v-card-text>
                  </v-card>
                </div>

                <div class="table-footer mobile-footer">
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
                        <v-icon icon="mdi-chevron-double-left" />
                      </template>
                      <template #prev>
                        <v-icon icon="mdi-chevron-left" class="mt-2" />
                      </template>
                      <template #next>
                        <v-icon icon="mdi-chevron-right" class="mt-2" />
                      </template>
                      <template #last>
                        <v-icon icon="mdi-chevron-double-right" />
                      </template>
                    </v-pagination>
                  </div>
                </div>
              </template>
            </div>

            <!-- DESKTOP/TABLET: TABLE -->
            <div v-else>
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
                <template #loading>
                  <v-skeleton-loader type="table-row@6" />
                </template>

                <template #item.time="{ item }">
                  <div :data-id="item._id">
                    <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.tripDate }}</div>
                  </div>
                </template>

                <template #item.category="{ item }">
                  <v-chip :color="item.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
                    <v-icon :icon="item.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'" size="16" />
                    <span class="ml-2">{{ categoryLabel(item.category) }}</span>
                  </v-chip>
                </template>

                <template #item.requester="{ item }">
                  <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                  </div>
                </template>

                <template #item.destination="{ item }">
                  <div class="truncate-2">
                    <span class="text-medium-emphasis">គោលដៅ៖ </span>
                    {{ prettyStops(item.stops) }}
                  </div>
                  <div class="mt-1" v-if="item.ticketUrl">
                    <a :href="absUrl(item.ticketUrl)" target="_blank" rel="noopener" class="text-decoration-none">
                      <v-btn size="x-small" color="indigo" variant="tonal">
                        <v-icon icon="mdi-paperclip" size="14" class="mr-1" /> សំបុត្រ
                      </v-btn>
                    </a>
                  </div>
                </template>

                <template #item.passengers="{ item }">
                  <div class="text-center">{{ item.passengers ?? 1 }}</div>
                </template>

                <template #item.status="{ item }">
                  <v-chip :color="statusColor(item.status)" size="small" label>
                    <v-icon :icon="statusIcon(item.status)" size="16" class="mr-1" />
                    {{ statusLabel(item.status) }}
                  </v-chip>
                </template>

                <template #item.driverAck="{ item }">
                  <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="small" label>
                    <v-icon :icon="ackIcon(item.assignment?.driverAck || 'PENDING')" size="16" class="mr-1" />
                    {{ ackLabel(item.assignment?.driverAck || 'PENDING') }}
                  </v-chip>
                </template>

                <!-- ACTIONS (desktop) -->
                <template #item.actions="{ item }">
                  <div class="d-flex justify-end" style="gap:6px; flex-wrap: wrap;">
                    <template v-if="canRespond(item)">
                      <v-btn
                        size="small"
                        color="success"
                        variant="flat"
                        :loading="actLoading === String(item._id)"
                        @click.stop="sendAck(item,'ACCEPTED')"
                      >
                        <v-icon icon="mdi-check" size="16" class="mr-1" /> យល់ព្រម
                      </v-btn>
                    </template>

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
                            <v-icon icon="mdi-sync" size="16" class="mr-2" />
                            បន្ទាន់សម័យស្ថានភាព
                          </v-btn>
                        </template>
                        <v-list density="compact" min-width="220">
                          <v-list-subheader>ស្ថានភាពបន្ទាប់</v-list-subheader>
                          <v-list-item
                            v-for="s in nextStatusesFor(item.status)"
                            :key="s"
                            @click.stop="setDriverStatus(item, s)"
                          >
                            <template #prepend>
                              <v-icon :icon="statusIcon(s)" size="18" />
                            </template>
                            <v-list-item-title>{{ statusLabel(s) }}</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>
                    </template>

                    <v-btn
                      size="small"
                      variant="tonal"
                      color="primary"
                      @click.stop="showDetails(item)"
                    >
                      <v-icon icon="mdi-information" size="16" class="mr-1" /> ព័ត៌មានលម្អិត
                    </v-btn>
                  </div>
                </template>

                <template #no-data>
                  <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
                    មិនមានការកក់រថយន្តទេ<span v-if="selectedDate"> នៅថ្ងៃទី {{ selectedDate }}</span>។
                  </v-sheet>
                </template>

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
                          <v-icon icon="mdi-chevron-double-left" />
                        </template>
                        <template #prev>
                          <v-icon icon="mdi-chevron-left" class="mt-2" />
                        </template>
                        <template #next>
                          <v-icon icon="mdi-chevron-right" class="mt-2" />
                        </template>
                        <template #last>
                          <v-icon icon="mdi-chevron-double-right" />
                        </template>
                      </v-pagination>
                    </div>
                  </div>
                </template>
              </v-data-table>
            </div>
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
              <v-icon :icon="detailItem?.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'" size="16" />
              <span class="ml-2">{{ categoryLabel(detailItem?.category || '') || '—' }}</span>
            </v-chip>
            <span class="mono">{{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}</span>
          </div>
          <v-btn icon variant="text" @click="detailOpen = false">
            <v-icon icon="mdi-close" />
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
                    <v-icon
                      :icon="s.destination === 'Airport' ? 'mdi-airplane' : 'mdi-map-marker'"
                      size="16"
                      class="mr-1"
                    />
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
                        <v-icon icon="mdi-link-variant" size="14" class="mr-1" /> ផែនទី
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
                  <v-icon :icon="statusIcon(detailItem?.status)" size="16" class="mr-1" />
                  {{ statusLabel(detailItem?.status || '—') }}
                </v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">ការឆ្លើយតបអ្នកបើកបរ</div>
              <div class="val">
                <v-chip :color="ackColor(detailItem?.assignment?.driverAck || 'PENDING')" size="small" label>
                  <v-icon :icon="ackIcon(detailItem?.assignment?.driverAck || 'PENDING')" size="16" class="mr-1" />
                  {{ ackLabel(detailItem?.assignment?.driverAck || 'PENDING') }}
                </v-chip>
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end" style="gap:8px;">
          <template v-if="detailItem && canRespond(detailItem)">
            <v-btn
              size="small"
              color="success"
              variant="flat"
              :loading="actLoading === String(detailItem?._id)"
              @click="sendAck(detailItem,'ACCEPTED')"
            >
              <v-icon icon="mdi-check" size="16" class="mr-1" /> យល់ព្រម
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
                  <v-icon icon="mdi-sync" size="16" class="mr-2" /> បន្ទាន់សម័យស្ថានភាព
                </v-btn>
              </template>
              <v-list density="compact" min-width="220">
                <v-list-subheader>ស្ថានភាពបន្ទាប់</v-list-subheader>
                <v-list-item
                  v-for="s in nextStatusesFor(detailItem.status)"
                  :key="s"
                  @click.stop="setDriverStatus(detailItem, s)"
                >
                  <template #prepend>
                    <v-icon :icon="statusIcon(s)" size="18" />
                  </template>
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
@import url('https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap');

.highlighted {
  animation: flashHighlight 2s ease-in-out;
  background: #e0f2fe !important;
}
@keyframes flashHighlight {
  0% { background: #e0f2fe; }
  100% { background: transparent; }
}

/* Apply Kantumruy Pro to this section */
.driver-section,
.driver-section * {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.driver-section {
  border: 1px solid #e6e8ee;
  background:#fff;
  border-radius: 12px;
}

/* HERO + FILTERS */
.driver-hero {
  display:flex;
  align-items:flex-end;
  justify-content:flex-start;
  gap:12px;
  padding: 14px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color:#000000;
  border-bottom: 1px solid rgba(255,255,255,.28);
  flex-wrap:wrap;
}

.fh-field {
  min-width: 200px;
  flex: 1 1 140px;
}
.fh-date {
  max-width: 160px;
}
.fh-status {
  max-width: 180px;
}
.fh-search {
  min-width: 220px;
  max-width: 280px;
}

/* inner card */
.soft-card {
  border: 1px solid #e9ecf3;
  border-radius: 12px;
  background:#fff;
}
.elevated {
  border: 1px solid #e9ecf3;
  border-radius: 12px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }

/* small spacing helpers */
.mr-1 { margin-right: .25rem; }
.mr-2 { margin-right: .5rem; }
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

:deep(.v-pagination .v-btn){ min-width: 32px; }
:deep(.v-pagination .v-btn .v-icon){ line-height: 1; }

/* MOBILE CARD LIST */
.driver-card-wrap {
  margin-top: 2px;
}
.driver-card-list {
  display:flex;
  flex-direction:column;
  gap:10px;
}
.driver-card {
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: radial-gradient(circle at top left, #eff6ff 0, #ffffff 38%, #f8fafc 100%);
  box-shadow: 0 10px 24px rgba(15,23,42,0.14);
}

.card-top {
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:8px;
}
.card-top-left {
  display:flex;
  flex-direction:column;
  gap:2px;
}
.card-time {
  font-size:.9rem;
}
.card-date {
  font-size:.78rem;
}

.card-row {
  display:flex;
  align-items:flex-start;
  gap:8px;
  margin-top:6px;
}
.card-row.small {
  margin-top:4px;
}
.card-row .lbl {
  min-width: 82px;
  font-size:.78rem;
  color:#64748b;
  padding-top:2px;
}
.card-row .val {
  font-weight:500;
  font-size:.9rem;
}
.notes-val {
  white-space: pre-wrap;
}

.card-actions-row {
  margin-top:10px;
  display:flex;
  flex-direction:column;
  gap:4px;
}

/* tablet & down */
@media (max-width: 960px){
  .driver-hero {
    padding: 12px 14px;
  }
}

/* phone */
@media (max-width: 600px){
  .driver-section {
    border-left:none;
    border-right:none;
    border-radius:0;
  }

  .driver-hero {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .fh-field {
    min-width: 0;
    width: 100%;
    max-width: 100%;
    flex: 1 1 100%;
  }
  .fh-date,
  .fh-status,
  .fh-search {
    width: 100%;
    max-width: 100%;
  }

  .table-footer.mobile-footer {
    flex-direction: column;
    align-items:flex-start;
    padding-inline: 4px;
  }
}
</style>
