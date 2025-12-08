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

/* responsive flag (no Vuetify) */
const isMobile = ref(false)
const updateIsMobile = () => {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ─────────────── LANGUAGE ─────────────── */
const lang = ref('km') // 'km' | 'en'

const TEXT = {
  datePlaceholder: {
    en: 'dd/mm/yyyy',
    km: 'dd/mm/yyyy',
  },
  statusPlaceholder: {
    en: 'All statuses',
    km: 'ស្ថានភាពទាំងអស់',
  },
  searchPlaceholder: {
    en: 'Search requester / purpose / destination',
    km: 'ស្វែងរកអ្នកស្នើសុំ / គោលបំណង / ទីតាំង',
  },
  noData: {
    en: 'No bookings',
    km: 'មិនមានការកក់រថយន្តទេ',
  },
  noDataForDateSuffix: {
    en: ' on this date.',
    km: ' សម្រាប់កាលបរិច្ឆេទនេះទេ។',
  },
  rangeOf: {
    en: 'of',
    km: 'ក្នុងចំណោម',
  },
  prev: {
    en: 'Prev',
    km: 'មុន',
  },
  next: {
    en: 'Next',
    km: 'បន្ទាប់',
  },
  agree: {
    en: 'Accept',
    km: 'យល់ព្រម',
  },
  details: {
    en: 'Details',
    km: 'ព័ត៌មានលម្អិត',
  },
  updateStatus: {
    en: 'Update status',
    km: 'បន្ទាន់សម័យស្ថានភាព',
  },
  nextStatuses: {
    en: 'Next statuses',
    km: 'ស្ថានភាពបន្ទាប់',
  },
  dateLabel: {
    en: 'Date',
    km: 'កាលបរិច្ឆេទ',
  },
  passengersLabel: {
    en: 'Passengers',
    km: 'អ្នកដំណើរ',
  },
  requesterLabel: {
    en: 'Requester',
    km: 'អ្នកស្នើសុំ',
  },
  routeLabel: {
    en: 'Route / Destination',
    km: 'ផ្លូវដំណើរ / គោលដៅ',
  },
  statusLabel: {
    en: 'Status',
    km: 'ស្ថានភាព',
  },
  driverAckLabel: {
    en: 'Driver response',
    km: 'ការឆ្លើយតបអ្នកបើកបរ',
  },
  close: {
    en: 'Close',
    km: 'បិទ',
  },
  snackAccepted: {
    en: 'You accepted this trip.',
    km: 'អ្នកបានព្រមទទួលភារកិច្ចនេះ។',
  },
  snackAckSaved: {
    en: 'Response saved.',
    km: 'បានកត់ត្រាការឆ្លើយតបរួចរាល់។',
  },
  snackStatusUpdated: {
    en: 'Status updated.',
    km: 'បានធ្វើបច្ចុប្បន្នភាពស្ថានភាព។',
  },
  snackError: {
    en: 'Action failed.',
    km: 'សកម្មភាពបរាជ័យ។',
  },
}

const t = key => TEXT[key]?.[lang.value] || key

/* Khmer status options for filter (values still English for backend) */
const statusOptions = [
  { labelKM: 'ទាំងអស់', labelEN: 'All', value: 'ALL' },
  { labelKM: 'កំពុងរង់ចាំ', labelEN: 'Pending', value: 'PENDING' },
  { labelKM: 'បានចាត់ចែង', labelEN: 'Assigned', value: 'ASSIGNED' },
  { labelKM: 'បានព្រមទទួល', labelEN: 'Accepted', value: 'ACCEPTED' },
  { labelKM: 'កំពុងធ្វើដំណើរ', labelEN: 'On road', value: 'ON_ROAD' },
  { labelKM: 'ជិតដល់គោលដៅ', labelEN: 'Arriving', value: 'ARRIVING' },
  { labelKM: 'បានបញ្ចប់', labelEN: 'Completed', value: 'COMPLETED' },
  { labelKM: 'យឺតយ៉ាវ', labelEN: 'Delayed', value: 'DELAYED' },
  { labelKM: 'បានបោះបង់', labelEN: 'Cancelled', value: 'CANCELLED' },
  { labelKM: 'បដិសេធ', labelEN: 'Declined', value: 'DECLINED' },
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

/* Dev override bar (optional – you can remove if not needed) */
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

/* ───────── LABEL MAPS (KH & EN) ───────── */
const STATUS_LABEL = {
  PENDING : { km: 'កំពុងរង់ចាំ', en: 'Pending' },
  ASSIGNED: { km: 'បានចាត់ចែង', en: 'Assigned' },
  ACCEPTED: { km: 'បានព្រមទទួល', en: 'Accepted' },
  ON_ROAD : { km: 'កំពុងធ្វើដំណើរ', en: 'On road' },
  ARRIVING: { km: 'ជិតដល់គោលដៅ', en: 'Arriving' },
  COMPLETED: { km: 'បានបញ្ចប់', en: 'Completed' },
  DELAYED : { km: 'យឺតយ៉ាវ', en: 'Delayed' },
  CANCELLED: { km: 'បានបោះបង់', en: 'Cancelled' },
  DECLINED: { km: 'បដិសេធ', en: 'Declined' },
}
const statusLabel = s => {
  const code = String(s || '').toUpperCase()
  const obj = STATUS_LABEL[code]
  if (!obj) return s
  return lang.value === 'km' ? obj.km : obj.en
}

const ACK_LABEL = {
  PENDING : { km: 'មិនទាន់ឆ្លើយ', en: 'No response' },
  ACCEPTED: { km: 'ព្រមទទួល', en: 'Accepted' },
  DECLINED: { km: 'បដិសេធ', en: 'Declined' },
}
const ackLabel = s => {
  const code = String(s || '').toUpperCase()
  const obj = ACK_LABEL[code]
  if (!obj) return s
  return lang.value === 'km' ? obj.km : obj.en
}

const CATEGORY_LABEL_KM = { Car: 'ឡាន', Motor: 'ម៉ូតូ' }
const CATEGORY_LABEL_EN = { Car: 'Car', Motor: 'Motorbike' }
const categoryLabel = c =>
  lang.value === 'km'
    ? (CATEGORY_LABEL_KM[c] || c)
    : (CATEGORY_LABEL_EN[c] || c)

/* icons/colors using Font Awesome */
const statusColorClass = s =>
  ({
    PENDING: 'bg-slate-400',
    ASSIGNED: 'bg-slate-500',
    ACCEPTED: 'bg-blue-500',
    ON_ROAD: 'bg-cyan-500',
    ARRIVING: 'bg-emerald-500',
    COMPLETED: 'bg-green-600',
    DELAYED: 'bg-amber-400',
    CANCELLED: 'bg-red-500',
    DECLINED: 'bg-red-700',
  }[String(s || '').toUpperCase()] || 'bg-slate-400')

const statusIcon = s =>
  ({
    PENDING:   'fa-regular fa-clock',
    ACCEPTED:  'fa-regular fa-circle-check',
    ON_ROAD:   'fa-solid fa-truck-fast',
    ARRIVING:  'fa-solid fa-flag-checkered',
    COMPLETED: 'fa-solid fa-check-double',
    DELAYED:   'fa-solid fa-triangle-exclamation',
    CANCELLED: 'fa-solid fa-circle-xmark',
    DECLINED:  'fa-solid fa-circle-xmark',
    ASSIGNED:  'fa-solid fa-id-badge',
  }[String(s || '').toUpperCase()] || 'fa-regular fa-clock')

const ackColorClass = s =>
  ({
    PENDING: 'bg-slate-500',
    ACCEPTED: 'bg-emerald-500',
    DECLINED: 'bg-red-500',
  }[String(s || '').toUpperCase()] || 'bg-slate-500')

const ackIcon = s =>
  ({
    PENDING:  'fa-regular fa-circle-question',
    ACCEPTED: 'fa-regular fa-thumbs-up',
    DECLINED: 'fa-regular fa-thumbs-down',
  }[String(s || '').toUpperCase()] || 'fa-regular fa-circle-question')

/* destination helper */
function destText(s = {}) {
  return s.destination === 'Other'
    ? s.destinationOther || 'Other'
    : s.destination
}

/* multi-stop display */
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
    error.value = e?.response?.data?.message || e?.message || t('snackError')
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

/* ─────────────── PAGINATION ─────────────── */
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

/* ─────────────── ACTIONS + TOAST ─────────────── */
const actLoading = ref('')
const statusLoading = ref('')
const snackVisible = ref(false)
const snackText = ref('')
const snackType = ref('info') // 'success' | 'error' | 'info'
let snackTimer = null

function showSnack(message, type = 'info') {
  snackText.value = message
  snackType.value = type
  snackVisible.value = true
  if (snackTimer) clearTimeout(snackTimer)
  snackTimer = setTimeout(() => {
    snackVisible.value = false
  }, 2200)
}

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

    showSnack(
      response === 'ACCEPTED' ? t('snackAccepted') : t('snackAckSaved'),
      'success'
    )
  } catch (e) {
    showSnack(
      e?.response?.data?.message || e?.message || t('snackError'),
      'error'
    )
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
    showSnack(t('snackStatusUpdated'), 'success')
  } catch (e) {
    await loadList()
    showSnack(
      e?.response?.data?.message || e?.message || t('snackError'),
      'error'
    )
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

/* ─────────────── DETAIL MODAL ─────────────── */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item) {
  detailItem.value = item
  detailOpen.value = true
}

/* ─────────────── LIFECYCLE ─────────────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }

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
        el.classList.add('ring-2', 'ring-sky-500', 'bg-sky-50')
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-sky-500', 'bg-sky-50')
        }, 2500)
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
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
})

watch([selectedDate, statusFilter], loadList)
</script>

<template>
  <div class="px-2 py-2 sm:px-4 text-slate-900 dark:text-slate-100">
    <!-- Dev identity bar (optional) -->
    <div
      v-if="!identity?.loginId"
      class="mb-2 flex flex-wrap items-center gap-2 text-xs"
    >
      <input
        v-model="devLoginId"
        type="text"
        placeholder="loginId"
        class="h-8 rounded-xl border border-slate-300 bg-white px-3 text-xs
               text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none
               focus:ring-1 focus:ring-sky-500
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      <select
        v-model="devRole"
        class="h-8 rounded-xl border border-slate-300 bg-white px-2 text-xs
               text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none
               focus:ring-1 focus:ring-sky-500
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="DRIVER">DRIVER</option>
        <option value="MESSENGER">MESSENGER</option>
      </select>
      <button
        type="button"
        class="inline-flex items-center rounded-xl bg-sky-600 px-3 py-1 text-xs
               font-semibold text-white shadow hover:bg-sky-500"
        @click="useDevIdentity"
      >
        USE
      </button>
    </div>

    <section
      class="driver-shell rounded-2xl border border-slate-200 bg-slate-50 shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- HERO FILTER BAR -->
      <header
        class="flex flex-wrap items-center gap-3
               rounded-t-2xl border-b border-slate-200
               bg-gradient-to-r from-[#0f719e] via-[#0b5c7f] to-[#05314a]
               px-4 py-3 text-slate-50
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
      >
        <div class="flex flex-1 flex-wrap items-center gap-2">
          <!-- date -->
          <div class="w-full max-w-[170px]">
            <label class="mb-1 block text-[10px] font-semibold tracking-wide">
              {{ t('dateLabel') }}
            </label>
            <input
              v-model="selectedDate"
              type="date"
              :placeholder="t('datePlaceholder')"
              class="h-9 w-full rounded-xl border border-sky-200 bg-sky-900/10 px-3
                     text-xs text-slate-50 placeholder-slate-200/70 shadow-sm
                     focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100
                     dark:placeholder-slate-500"
            />
          </div>

          <!-- status -->
          <div class="w-full max-w-[180px]">
            <label class="mb-1 block text-[10px] font-semibold tracking-wide">
              {{ t('statusLabel') }}
            </label>
            <select
              v-model="statusFilter"
              class="h-9 w-full rounded-xl border border-sky-200 bg-sky-900/10 px-3
                     text-xs text-slate-50 shadow-sm
                     focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option
                v-for="opt in statusOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ lang === 'km' ? opt.labelKM : opt.labelEN }}
              </option>
            </select>
          </div>

          <!-- search -->
          <div class="min-w-[200px] flex-1">
            <label class="mb-1 block text-[10px] font-semibold tracking-wide">
              {{ t('searchPlaceholder') }}
            </label>
            <div
              class="flex h-9 items-center rounded-xl border border-sky-200 bg-sky-900/10
                     px-2 text-xs shadow-sm
                     focus-within:border-amber-300 focus-within:ring-1 focus-within:ring-amber-300
                     dark:border-slate-600 dark:bg-slate-900"
            >
              <i class="fa-solid fa-magnify-glass mr-2 text-[11px] text-slate-200" />
              <input
                v-model="qSearch"
                type="text"
                :placeholder="t('searchPlaceholder')"
                class="h-full w-full bg-transparent text-xs text-slate-50
                       placeholder-slate-200/70 focus:outline-none
                       dark:text-slate-100 dark:placeholder-slate-500"
              />
            </div>
          </div>
        </div>

        <!-- language toggle -->
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="rounded-full px-3 py-1 text-[11px] font-semibold transition
                   border border-amber-300/80"
            :class="lang === 'km'
              ? 'bg-amber-300 text-slate-900'
              : 'bg-slate-900/40 text-slate-100'"
            @click="lang = 'km'"
          >
            ខ្មែរ
          </button>
          <button
            type="button"
            class="rounded-full px-3 py-1 text-[11px] font-semibold transition
                   border border-amber-300/80"
            :class="lang === 'en'
              ? 'bg-amber-300 text-slate-900'
              : 'bg-slate-900/40 text-slate-100'"
            @click="lang = 'en'"
          >
            EN
          </button>
        </div>
      </header>

      <!-- error banner -->
      <div
        v-if="error"
        class="mx-4 mt-3 rounded-md border border-rose-500 bg-rose-50 px-3 py-2
               text-[11px] text-rose-700
               dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ error }}
      </div>

      <!-- CONTENT -->
      <div class="p-3 sm:p-4">
        <!-- MOBILE: CARD LIST -->
        <div v-if="isMobile" class="space-y-2">
          <div
            v-if="loading"
            class="rounded-xl border border-slate-200 bg-slate-100 p-4 text-center
                   text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900
                   dark:text-slate-300"
          >
            {{ lang === 'km' ? 'កំពុងផ្ទុក…' : 'Loading…' }}
          </div>

          <template v-else>
            <div
              v-if="!paged.length"
              class="rounded-xl border border-dashed border-slate-400 bg-slate-100 p-4
                     text-center text-xs text-slate-500 dark:border-slate-600
                     dark:bg-slate-900 dark:text-slate-300"
            >
              {{ t('noData') }}
              <span v-if="selectedDate">
                {{ lang === 'km' ? '' : '' }} {{ selectedDate }}{{ t('noDataForDateSuffix') }}
              </span>
            </div>

            <article
              v-for="item in paged"
              :key="item._id"
              :data-id="item._id"
              class="rounded-2xl border border-slate-200 bg-white/90 p-3 text-xs
                     shadow-sm dark:border-slate-700 dark:bg-slate-950/80"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <div class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5
                              text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                    <i
                      :class="item.category === 'Car' ? 'fa-solid fa-car' : 'fa-solid fa-motorcycle'"
                      class="mr-1 text-[11px]"
                    />
                    <span>{{ categoryLabel(item.category) }}</span>
                  </div>
                  <div class="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {{ item.timeStart }} – {{ item.timeEnd }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ item.tripDate }}
                  </div>
                </div>

                <div class="flex flex-col items-end gap-1">
                  <span
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]
                           font-semibold text-white"
                    :class="statusColorClass(item.status)"
                  >
                    <i :class="statusIcon(item.status)" class="text-[11px]" />
                    <span>{{ statusLabel(item.status) }}</span>
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5
                           text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <i :class="ackIcon(item.assignment?.driverAck || 'PENDING')" class="text-[11px]" />
                    <span>{{ ackLabel(item.assignment?.driverAck || 'PENDING') }}</span>
                  </span>
                </div>
              </div>

              <div class="mt-2 space-y-1">
                <div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ t('requesterLabel') }}
                  </div>
                  <div class="font-semibold">
                    {{ item.employee?.name || '—' }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                  </div>
                </div>

                <div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ t('routeLabel') }}
                  </div>
                  <div class="text-[11px]">
                    {{ prettyStops(item.stops) }}
                  </div>
                </div>

                <div class="flex gap-6 text-[11px]">
                  <div>
                    <span class="text-slate-500 dark:text-slate-400">
                      {{ t('passengersLabel') }}:
                    </span>
                    <span class="font-semibold"> {{ item.passengers ?? 1 }}</span>
                  </div>
                  <div v-if="item.purpose">
                    <span class="text-slate-500 dark:text-slate-400">Purpose:</span>
                    <span class="font-semibold"> {{ item.purpose }}</span>
                  </div>
                </div>
              </div>

              <!-- actions -->
              <div class="mt-3 flex flex-col gap-2">
                <button
                  v-if="canRespond(item)"
                  type="button"
                  class="flex w-full items-center justify-center gap-1 rounded-full
                         bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white
                         disabled:opacity-60"
                  :disabled="actLoading === String(item._id)"
                  @click.stop="sendAck(item,'ACCEPTED')"
                >
                  <i class="fa-regular fa-circle-check text-[11px]" />
                  <span>{{ t('agree') }}</span>
                </button>

                <div class="flex flex-wrap gap-2">
                  <button
                    v-if="canChangeStatus(item)"
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 rounded-full
                           bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white
                           disabled:opacity-60"
                    :disabled="statusLoading === String(item._id)"
                    @click.stop="detailItem = item; detailOpen = true"
                  >
                    <i class="fa-solid fa-arrows-rotate text-[11px]" />
                    <span>{{ t('updateStatus') }}</span>
                  </button>

                  <button
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 rounded-full
                           bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-50"
                    @click.stop="showDetails(item)"
                  >
                    <i class="fa-solid fa-circle-info text-[11px]" />
                    <span>{{ t('details') }}</span>
                  </button>
                </div>
              </div>
            </article>

            <!-- mobile footer -->
            <div
              v-if="paged.length"
              class="mt-2 flex flex-col items-start justify-between gap-2 border-t
                     border-slate-200 pt-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300"
            >
              <div>
                {{ rangeStart }}–{{ rangeEnd }}
                {{ t('rangeOf') }}
                {{ totalItems }}
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-full border border-slate-400 px-2 py-1
                         text-[11px] text-slate-700 hover:bg-slate-100
                         disabled:opacity-40 dark:border-slate-500 dark:text-slate-100
                         dark:hover:bg-slate-800"
                  :disabled="page === 1"
                  @click="page--"
                >
                  {{ t('prev') }}
                </button>
                <span class="text-[11px]">
                  Page {{ page }} / {{ pageCount }}
                </span>
                <button
                  type="button"
                  class="rounded-full border border-slate-400 px-2 py-1
                         text-[11px] text-slate-700 hover:bg-slate-100
                         disabled:opacity-40 dark:border-slate-500 dark:text-slate-100
                         dark:hover:bg-slate-800"
                  :disabled="page === pageCount"
                  @click="page++"
                >
                  {{ t('next') }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- DESKTOP TABLE -->
        <div v-else>
          <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white/90
                      dark:border-slate-700 dark:bg-slate-950/90">
            <table class="min-w-full text-xs sm:text-sm">
              <thead
                class="bg-slate-100 text-[11px] font-semibold text-slate-700
                       dark:bg-slate-800 dark:text-slate-100"
              >
                <tr>
                  <th class="px-3 py-2 text-left">ម៉ោង</th>
                  <th class="px-3 py-2 text-left">ប្រភេទ</th>
                  <th class="px-3 py-2 text-left">{{ t('requesterLabel') }}</th>
                  <th class="px-3 py-2 text-left">{{ t('routeLabel') }}</th>
                  <th class="px-3 py-2 text-center">{{ t('passengersLabel') }}</th>
                  <th class="px-3 py-2 text-right">{{ t('statusLabel') }}</th>
                  <th class="px-3 py-2 text-right">{{ t('driverAckLabel') }}</th>
                  <th class="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in paged"
                  :key="item._id"
                  :data-id="item._id"
                  class="border-t border-slate-100 text-[11px] hover:bg-slate-50
                         dark:border-slate-800 dark:hover:bg-slate-900"
                >
                  <!-- time -->
                  <td class="px-3 py-2 align-top">
                    <div class="font-mono text-[11px]">
                      {{ item.timeStart }} – {{ item.timeEnd }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.tripDate }}
                    </div>
                  </td>

                  <!-- category -->
                  <td class="px-3 py-2 align-top">
                    <div
                      class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5
                             text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <i
                        :class="item.category === 'Car' ? 'fa-solid fa-car' : 'fa-solid fa-motorcycle'"
                        class="text-[11px]"
                      />
                      <span>{{ categoryLabel(item.category) }}</span>
                    </div>
                  </td>

                  <!-- requester -->
                  <td class="px-3 py-2 align-top">
                    <div class="font-semibold">
                      {{ item.employee?.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                    </div>
                  </td>

                  <!-- destination -->
                  <td class="px-3 py-2 align-top">
                    <div class="text-[11px]">
                      {{ prettyStops(item.stops) }}
                    </div>
                    <div class="mt-1" v-if="item.ticketUrl">
                      <a
                        :href="absUrl(item.ticketUrl)"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5
                               text-[11px] text-indigo-700 hover:bg-indigo-200
                               dark:bg-indigo-900/40 dark:text-indigo-200 dark:hover:bg-indigo-800/70"
                      >
                        <i class="fa-solid fa-paperclip text-[11px]" />
                        <span>សំបុត្រ</span>
                      </a>
                    </div>
                  </td>

                  <!-- passengers -->
                  <td class="px-3 py-2 text-center align-top">
                    {{ item.passengers ?? 1 }}
                  </td>

                  <!-- status -->
                  <td class="px-3 py-2 text-right align-top">
                    <span
                      class="inline-flex items-center justify-end gap-1 rounded-full px-2 py-0.5
                             text-[11px] font-semibold text-white"
                      :class="statusColorClass(item.status)"
                    >
                      <i :class="statusIcon(item.status)" class="text-[11px]" />
                      <span>{{ statusLabel(item.status) }}</span>
                    </span>
                  </td>

                  <!-- driver ack -->
                  <td class="px-3 py-2 text-right align-top">
                    <span
                      class="inline-flex items-center justify-end gap-1 rounded-full px-2 py-0.5
                             text-[11px] font-semibold text-white"
                      :class="ackColorClass(item.assignment?.driverAck || 'PENDING')"
                    >
                      <i :class="ackIcon(item.assignment?.driverAck || 'PENDING')" class="text-[11px]" />
                      <span>{{ ackLabel(item.assignment?.driverAck || 'PENDING') }}</span>
                    </span>
                  </td>

                  <!-- actions -->
                  <td class="px-3 py-2 text-right align-top">
                    <div class="flex flex-wrap justify-end gap-2">
                      <button
                        v-if="canRespond(item)"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-600
                               px-3 py-1.5 text-[11px] font-semibold text-white
                               disabled:opacity-60"
                        :disabled="actLoading === String(item._id)"
                        @click.stop="sendAck(item,'ACCEPTED')"
                      >
                        <i class="fa-regular fa-circle-check text-[11px]" />
                        <span>{{ t('agree') }}</span>
                      </button>

                      <button
                        v-if="canChangeStatus(item)"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-sky-600
                               px-3 py-1.5 text-[11px] font-semibold text-white
                               disabled:opacity-60"
                        :disabled="statusLoading === String(item._id)"
                        @click.stop="detailItem = item; detailOpen = true"
                      >
                        <i class="fa-solid fa-arrows-rotate text-[11px]" />
                        <span>{{ t('updateStatus') }}</span>
                      </button>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-slate-800
                               px-3 py-1.5 text-[11px] font-semibold text-slate-50"
                        @click.stop="showDetails(item)"
                      >
                        <i class="fa-solid fa-circle-info text-[11px]" />
                        <span>{{ t('details') }}</span>
                      </button>
                    </div>
                  </td>
                </tr>

                <tr v-if="!paged.length && !loading">
                  <td
                    colspan="8"
                    class="px-3 py-4 text-center text-[11px] text-slate-500
                           dark:text-slate-300"
                  >
                    {{ t('noData') }}
                    <span v-if="selectedDate">
                      {{ selectedDate }}{{ t('noDataForDateSuffix') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- table footer -->
          <div
            v-if="paged.length"
            class="mt-2 flex items-center justify-between border-t border-slate-200
                   px-2 py-2 text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300"
          >
            <div>
              {{ rangeStart }}–{{ rangeEnd }}
              {{ t('rangeOf') }}
              {{ totalItems }}
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-full border border-slate-400 px-2 py-1
                       text-[11px] text-slate-700 hover:bg-slate-100
                       disabled:opacity-40 dark:border-slate-500 dark:text-slate-100
                       dark:hover:bg-slate-800"
                :disabled="page === 1"
                @click="page--"
              >
                {{ t('prev') }}
              </button>
              <span class="text-[11px]">
                Page {{ page }} / {{ pageCount }}
              </span>
              <button
                type="button"
                class="rounded-full border border-slate-400 px-2 py-1
                       text-[11px] text-slate-700 hover:bg-slate-100
                       disabled:opacity-40 dark:border-slate-500 dark:text-slate-100
                       dark:hover:bg-slate-800"
                :disabled="page === pageCount"
                @click="page++"
              >
                {{ t('next') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Detail modal -->
    <transition name="fade">
      <div
        v-if="detailOpen && detailItem"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      >
        <div
            class="driver-dialog w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-xs
                 shadow-xl dark:border-slate-700 dark:bg-slate-950"
        >
          <header class="mb-2 flex items-start justify-between gap-2">
            <div class="space-y-1">
              <div
                class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5
                       text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <i
                  :class="detailItem.category === 'Car' ? 'fa-solid fa-car' : 'fa-solid fa-motorcycle'"
                  class="text-[11px]"
                />
                <span>{{ categoryLabel(detailItem.category || 'Car') }}</span>
              </div>
              <div class="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                {{ detailItem.timeStart }} – {{ detailItem.timeEnd }}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ t('dateLabel') }}: {{ detailItem.tripDate || '—' }}
              </div>
            </div>
            <button
              type="button"
              class="rounded-full bg-slate-100 p-1 text-slate-600 hover:bg-slate-200
                     dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              @click="detailOpen = false"
            >
              <i class="fa-solid fa-xmark text-[12px]" />
            </button>
          </header>

          <div class="space-y-2">
            <div class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                {{ t('passengersLabel') }}
              </span>
              <span class="font-semibold">
                {{ detailItem.passengers ?? 1 }}
              </span>
            </div>

            <div class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                {{ t('requesterLabel') }}
              </span>
              <span class="font-semibold">
                {{ detailItem.employee?.name || '—' }}
                <span
                  class="block text-[10px] font-normal text-slate-500 dark:text-slate-400"
                >
                  {{ detailItem.employee?.department || '—' }} •
                  ID {{ detailItem.employeeId }}
                </span>
              </span>
            </div>

            <div>
              <div class="text-slate-500 dark:text-slate-400">
                {{ t('routeLabel') }}
              </div>
              <div
                v-if="(detailItem.stops || []).length"
                class="mt-1 space-y-1"
              >
                <div
                  v-for="(s,i) in detailItem.stops"
                  :key="i"
                  class="flex flex-wrap items-center gap-1 text-[11px]"
                >
                  <i
                    class="fa-solid"
                    :class="s.destination === 'Airport' ? 'fa-plane-departure' : 'fa-map-marker-alt'"
                  />
                  <span class="font-semibold">#{{ i+1 }}:</span>
                  <span>{{ destText(s) }}</span>
                  <a
                    v-if="s.mapLink"
                    :href="absUrl(s.mapLink)"
                    target="_blank"
                    rel="noopener"
                    class="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5
                           text-[11px] text-sky-600 hover:bg-sky-50 dark:text-sky-300
                           dark:hover:bg-sky-900/60"
                  >
                    <i class="fa-solid fa-link text-[11px]" />
                    <span>Map</span>
                  </a>
                </div>
              </div>
              <div v-else class="text-[11px] text-slate-500 dark:text-slate-400">—</div>
            </div>

            <div class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                {{ t('statusLabel') }}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5
                       text-[11px] font-semibold text-white"
                :class="statusColorClass(detailItem.status)"
              >
                <i :class="statusIcon(detailItem.status)" class="text-[11px]" />
                <span>{{ statusLabel(detailItem.status) }}</span>
              </span>
            </div>

            <div class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                {{ t('driverAckLabel') }}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5
                       text-[11px] font-semibold text-white"
                :class="ackColorClass(detailItem.assignment?.driverAck || 'PENDING')"
              >
                <i :class="ackIcon(detailItem.assignment?.driverAck || 'PENDING')" class="text-[11px]" />
                <span>{{ ackLabel(detailItem.assignment?.driverAck || 'PENDING') }}</span>
              </span>
            </div>

            <div v-if="detailItem.purpose" class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                Purpose
              </span>
              <span class="font-semibold">
                {{ detailItem.purpose }}
              </span>
            </div>

            <div v-if="detailItem.notes" class="flex gap-2">
              <span class="min-w-[80px] text-slate-500 dark:text-slate-400">
                Notes
              </span>
              <span class="whitespace-pre-wrap">
                {{ detailItem.notes }}
              </span>
            </div>
          </div>

          <footer class="mt-3 flex justify-end gap-2">
            <button
              v-if="detailItem && canRespond(detailItem)"
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5
                     text-[11px] font-semibold text-white disabled:opacity-60"
              :disabled="actLoading === String(detailItem?._id)"
              @click="sendAck(detailItem,'ACCEPTED')"
            >
              <i class="fa-regular fa-circle-check text-[11px]" />
              <span>{{ t('agree') }}</span>
            </button>
            <button
              v-if="detailItem && canChangeStatus(detailItem)"
              v-for="s in nextStatusesFor(detailItem.status)"
              :key="s"
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-sky-600 px-3 py-1.5
                     text-[11px] font-semibold text-white disabled:opacity-60"
              :disabled="statusLoading === String(detailItem?._id)"
              @click="setDriverStatus(detailItem, s)"
            >
              <i :class="statusIcon(s)" class="text-[11px]" />
              <span>{{ statusLabel(s) }}</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-slate-700 px-3 py-1.5
                     text-[11px] font-semibold text-slate-100"
              @click="detailOpen = false"
            >
              <span>{{ t('close') }}</span>
            </button>
          </footer>
        </div>
      </div>
    </transition>

    <!-- Simple toast -->
    <transition name="fade">
      <div
        v-if="snackVisible"
        class="fixed bottom-4 right-4 z-40 max-w-xs rounded-xl px-3 py-2 text-[11px]
               shadow-lg"
        :class="{
          'bg-emerald-600 text-white': snackType === 'success',
          'bg-rose-600 text-white': snackType === 'error',
          'bg-slate-800 text-slate-100': snackType === 'info',
        }"
      >
        {{ snackText }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap');

/* Apply Kantumruy only to containers, let Font Awesome control its own font */
.driver-shell,
.driver-dialog {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* simple fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* This deep rule is only needed if you still use Vuetify dialogs somewhere */
:deep(.v-overlay__content),
:deep(.v-overlay__content *) {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
}
</style>
