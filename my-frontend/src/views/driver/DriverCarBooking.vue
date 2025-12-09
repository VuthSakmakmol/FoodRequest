<!-- src/views/driver/DriverCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded, subscribeBookingRooms } from '@/utils/socket'
import { useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'

/* ─────────────── TOAST ─────────────── */
const { showToast } = useToast()

/* ─────────────── LANGUAGE TOGGLE ─────────────── */
const lang = ref('km') // 'km' | 'en'

const TEXT = {
  dateLabel:        { en: 'Date',                       km: 'កាលបរិច្ឆេទ' },
  statusLabel:      { en: 'Status',                     km: 'ស្ថានភាព' },
  searchPlaceholder:{ en: 'Search requester / purpose / destination', km: 'ស្វែងរកអ្នកស្នើសុំ / គោលបំណង / ទីតាំង' },

  requester:        { en: 'Requester',                  km: 'អ្នកស្នើសុំ' },
  destination:      { en: 'Destination',                km: 'គោលដៅ' },
  passengers:       { en: 'Passengers',                 km: 'អ្នកដំណើរ' },
  purpose:          { en: 'Purpose',                    km: 'គោលបំណង' },
  notes:            { en: 'Notes',                      km: 'ចំណាំ' },
  ticket:           { en: 'Ticket',                     km: 'សំបុត្រ' },
  details:          { en: 'Details',                    km: 'ព័ត៌មានលម្អិត' },
  close:            { en: 'Close',                      km: 'បិទ' },

  nextStatuses:     { en: 'Next statuses',              km: 'ស្ថានភាពបន្ទាប់' },
  noBookings:       { en: 'No bookings found',          km: 'មិនមានការកក់រថយន្តទេ' },
  agree:            { en: 'Accept',                     km: 'យល់ព្រម' },
  routeTitle:       { en: 'Route / Destinations',       km: 'ផ្លូវដំណើរ / គោលដៅ' },
  driverResponse:   { en: 'Driver response',            km: 'ការឆ្លើយតបអ្នកបើកបរ' },

  tableTime:        { en: 'Time',                       km: 'ម៉ោង' },
  tableCategory:    { en: 'Category',                   km: 'ប្រភេទ' },
  tableRequester:   { en: 'Requester',                  km: 'អ្នកស្នើសុំ' },
  tableDestination: { en: 'Destination',                km: 'គោលដៅ' },
  tablePassengers:  { en: 'Passengers',                 km: 'អ្នកដំណើរ' },
  tableStatus:      { en: 'Status',                     km: 'ស្ថានភាព' },
  tableDriverAck:   { en: 'Driver/Messenger',           km: 'អ្នកបើកឡាន / ម៉ូតូ' },
  tableActions:     { en: 'Actions',                    km: 'សកម្មភាព' },

  statusAll:        { en: 'All',                        km: 'ទាំងអស់' },
}

const t = key => TEXT[key]?.[lang.value] || key

/* ─────────────── STATE ─────────────── */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const route = useRoute()

const selectedDate = ref('')
const statusFilter = ref('ALL')
const qSearch      = ref('')

/* responsive: simple breakpoint */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

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
      if (u?.loginId || u?.user?.loginId) {
        found.push({
          loginId: String(u.loginId || u?.user?.loginId),
          role: String(u.role || u?.user?.role || '').toUpperCase(),
        })
      }
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

/* ─────────────── LABEL MAPS (EN + KM) ─────────────── */
const STATUS_LABEL = {
  PENDING : { en: 'Pending',           km: 'កំពុងរង់ចាំ' },
  ASSIGNED: { en: 'Assigned',          km: 'បានចាត់ចែង' },
  ACCEPTED: { en: 'Accepted',          km: 'បានព្រមទទួល' },
  ON_ROAD : { en: 'On road',           km: 'កំពុងធ្វើដំណើរ' },
  ARRIVING: { en: 'Arriving soon',     km: 'ជិតដល់គោលដៅ' },
  COMPLETED:{ en: 'Completed',         km: 'បានបញ្ចប់' },
  DELAYED : { en: 'Delayed',           km: 'យឺតយ៉ាវ' },
  CANCELLED:{ en: 'Cancelled',         km: 'បានបោះបង់' },
  DECLINED: { en: 'Declined',          km: 'បដិសេធ' },
}
const statusLabel = s => {
  const code = String(s || '').toUpperCase()
  return STATUS_LABEL[code]?.[lang.value] || STATUS_LABEL[code]?.km || s
}

const ACK_LABEL = {
  PENDING : { en: 'No reply yet',      km: 'មិនទាន់ឆ្លើយ' },
  ACCEPTED: { en: 'Accepted',         km: 'ព្រមទទួល' },
  DECLINED: { en: 'Declined',         km: 'បដិសេធ' },
}
const ackLabel = s => {
  const code = String(s || '').toUpperCase()
  return ACK_LABEL[code]?.[lang.value] || ACK_LABEL[code]?.km || s
}

const CATEGORY_LABEL = {
  Car  : { en: 'Car',        km: 'ឡាន' },
  Motor: { en: 'Motorbike',  km: 'ម៉ូតូ' },
}
const categoryLabel = c =>
  CATEGORY_LABEL[c]?.[lang.value] || CATEGORY_LABEL[c]?.km || c

/* Status filter options (label depends on language) */
const statusOptions = computed(() => [
  { label: t('statusAll'), value: 'ALL' },
  { label: statusLabel('PENDING'),   value: 'PENDING' },
  { label: statusLabel('ASSIGNED'),  value: 'ASSIGNED' },
  { label: statusLabel('ACCEPTED'),  value: 'ACCEPTED' },
  { label: statusLabel('ON_ROAD'),   value: 'ON_ROAD' },
  { label: statusLabel('ARRIVING'),  value: 'ARRIVING' },
  { label: statusLabel('COMPLETED'), value: 'COMPLETED' },
  { label: statusLabel('DELAYED'),   value: 'DELAYED' },
  { label: statusLabel('CANCELLED'), value: 'CANCELLED' },
  { label: statusLabel('DECLINED'),  value: 'DECLINED' },
])

/* ─────────────── ROLE / HEADERS ─────────────── */
const roleLabel = computed(() => {
  const isMessenger = identity.value?.role === 'MESSENGER'
  if (isMessenger) {
    return lang.value === 'km' ? 'អ្នកបើកម៉ូតូ' : 'Messenger'
  }
  return lang.value === 'km' ? 'អ្នកបើកឡាន' : 'Driver'
})

const headers = computed(() => [
  { title: t('tableTime'),        key: 'time',        width: 160 },
  { title: t('tableCategory'),    key: 'category',    width: 120 },
  { title: t('tableRequester'),   key: 'requester',   width: 230 },
  { title: t('tableDestination'), key: 'destination' },
  { title: t('tablePassengers'),  key: 'passengers',  width: 70,  align: 'center' },
  { title: t('tableStatus'),      key: 'status',      width: 150, align: 'right' },
  { title: roleLabel.value,       key: 'driverAck',   width: 150, align: 'right' },
  { title: t('tableActions'),     key: 'actions',     width: 260, align: 'right' },
])

/* ─────────────── COLORS / ICONS (Tailwind + FA) ─────────────── */
const STATUS_BADGE_CLASS = {
  PENDING:
    'bg-slate-100 text-slate-900 border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-500',
  ASSIGNED:
    'bg-sky-100 text-sky-900 border-sky-500 dark:bg-sky-900/40 dark:text-sky-100 dark:border-sky-500',
  ACCEPTED:
    'bg-emerald-100 text-emerald-900 border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-500',
  ON_ROAD:
    'bg-sky-100 text-sky-900 border-sky-500 dark:bg-sky-900/40 dark:text-sky-100 dark:border-sky-500',
  ARRIVING:
    'bg-teal-100 text-teal-900 border-teal-500 dark:bg-teal-900/40 dark:text-teal-100 dark:border-teal-500',
  COMPLETED:
    'bg-lime-100 text-lime-900 border-lime-500 dark:bg-lime-900/40 dark:text-lime-100 dark:border-lime-500',
  DELAYED:
    'bg-amber-100 text-amber-900 border-amber-500 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-500',
  CANCELLED:
    'bg-rose-100 text-rose-900 border-rose-500 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-500',
  DECLINED:
    'bg-rose-100 text-rose-900 border-rose-500 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-500',
}
const statusBadgeClass = s =>
  `inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
    STATUS_BADGE_CLASS[String(s || '').toUpperCase()] ||
    'bg-slate-100 text-slate-900 border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-500'
  }`

const STATUS_ICON_FA = {
  PENDING:   'fa-regular fa-clock',
  ASSIGNED:  'fa-solid fa-id-badge',
  ACCEPTED:  'fa-regular fa-circle-check',
  ON_ROAD:   'fa-solid fa-truck-fast',
  ARRIVING:  'fa-solid fa-flag-checkered',
  COMPLETED: 'fa-solid fa-check-double',
  DELAYED:   'fa-solid fa-triangle-exclamation',
  CANCELLED: 'fa-regular fa-circle-xmark',
  DECLINED:  'fa-regular fa-circle-xmark',
}
const statusIconClass = s => STATUS_ICON_FA[String(s || '').toUpperCase()] || 'fa-regular fa-clock'

const ACK_BADGE_CLASS = {
  PENDING:
    'bg-slate-100 text-slate-900 border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-500',
  ACCEPTED:
    'bg-emerald-100 text-emerald-900 border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-500',
  DECLINED:
    'bg-rose-100 text-rose-900 border-rose-500 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-500',
}
const ackBadgeClass = s =>
  `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
    ACK_BADGE_CLASS[String(s || '').toUpperCase()] ||
    'bg-slate-100 text-slate-900 border-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-500'
  }`

const ACK_ICON_FA = {
  PENDING : 'fa-regular fa-circle-question',
  ACCEPTED: 'fa-regular fa-thumbs-up',
  DECLINED: 'fa-regular fa-thumbs-down',
}
const ackIconClass = s => ACK_ICON_FA[String(s || '').toUpperCase()] || 'fa-regular fa-circle-question'

/* destination text helper */
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
  const base = (api.defaults.baseURL || '')
    .replace(/\/api\/?$/, '')
    .replace(/\/$/, '')
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
    showToast({
      type: 'error',
      title: lang.value === 'km' ? 'បញ្ហាក្នុងការផ្ទុកទិន្នន័យ' : 'Failed to load data',
      message: error.value,
    })
  } finally {
    loading.value = false
  }
}

/* ─────────────── FILTERED / SORTED + PAGINATION ─────────────── */
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
const nextStatusesFor = from =>
  ALLOWED_NEXT[String(from || '').toUpperCase()] || []

const canChangeStatus = it =>
  isMine(it) &&
  ((it?.assignment?.driverAck || it?.assignment?.messengerAck) === 'ACCEPTED') &&
  !terminalStates.includes(String(it?.status || '').toUpperCase())

/* ─────────────── ACTIONS ─────────────── */
const actLoading = ref('')
const statusLoading = ref('')

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
    if (isMessenger) {
      item.assignment = {
        ...item.assignment,
        messengerAck: response,
        messengerAckAt: new Date(),
      }
    } else {
      item.assignment = {
        ...item.assignment,
        driverAck: response,
        driverAckAt: new Date(),
      }
    }

    showToast({
      type: 'success',
      title: lang.value === 'km' ? 'បានកត់ត្រាការឆ្លើយតប' : 'Response recorded',
      message:
        response === 'ACCEPTED'
          ? (lang.value === 'km'
              ? 'អ្នកបានព្រមទទួលភារកិច្ចនេះ។'
              : 'You have accepted this job.')
          : (lang.value === 'km'
              ? 'បានកត់ត្រាការឆ្លើយតបរួចរាល់។'
              : 'Response has been recorded.'),
    })
  } catch (e) {
    showToast({
      type: 'error',
      title: lang.value === 'km' ? 'សកម្មភាពបរាជ័យ' : 'Action failed',
      message: e?.response?.data?.message || e?.message || 'សកម្មភាពបរាជ័យ',
    })
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

    showToast({
      type: 'success',
      title: lang.value === 'km'
        ? 'បានបច្ចុប្បន្នភាពស្ថានភាព'
        : 'Status updated',
      message: lang.value === 'km'
        ? `បានធ្វើបច្ចុប្បន្នភាពស្ថានភាពទៅ ${statusLabel(nextStatus)}។`
        : `Status changed to ${statusLabel(nextStatus)}.`,
    })
  } catch (e) {
    await loadList()
    showToast({
      type: 'error',
      title: lang.value === 'km'
        ? 'មិនអាចបច្ចុប្បន្នភាពស្ថានភាពបាន'
        : 'Cannot update status',
      message:
        e?.response?.data?.message ||
        e?.message ||
        'មិនអាចបច្ចុប្បន្នភាពស្ថានភាពបាន',
    })
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

  const st = String(doc.status || '').toUpperCase()
  if (statusFilter.value !== 'ALL' && st !== statusFilter.value) return

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
  if (p.response) {
    it.assignment = {
      ...it.assignment,
      driverAck: p.response,
      messengerAck: p.response,
    }
  }
}

/* ─────────────── DETAILS MODAL ─────────────── */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item) {
  detailItem.value = item
  detailOpen.value = true
}
function closeDetails() {
  detailOpen.value = false
}

/* ─────────────── LIFECYCLE ─────────────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }

  subscribeRoleIfNeeded(identity.value)

  if (route.query?.date) {
    selectedDate.value = String(route.query.date)
  }

  await loadList()

  const focusId = route.query?.focus ? String(route.query.focus) : ''
  if (focusId) {
    await nextTick()
    setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${focusId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('highlight-row')
        setTimeout(() => el.classList.remove('highlight-row'), 2500)
      }
    }, 200)
  }

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

watch([selectedDate, statusFilter], () => {
  page.value = 1
  loadList()
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <!-- Dev identity bar -->
    <div
      v-if="!identity?.loginId"
      class="mb-2 flex flex-wrap items-center gap-2 text-xs"
    >
      <input
        v-model="devLoginId"
        type="text"
        placeholder="loginId (dev only)"
        class="h-8 rounded-lg border border-slate-300 px-2 text-xs outline-none
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      <select
        v-model="devRole"
        class="h-8 rounded-lg border border-slate-300 px-2 text-xs outline-none
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="DRIVER">DRIVER</option>
        <option value="MESSENGER">MESSENGER</option>
      </select>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700"
        @click="useDevIdentity"
      >
        USE
      </button>
    </div>

    <div
      class="driver-shell rounded-2xl border border-slate-300 bg-slate-100/80 shadow-sm
             dark:border-slate-700 dark:bg-slate-900/90"
    >
      <!-- HERO FILTER BAR -->
            <!-- HERO FILTER BAR (compact) -->
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-400
               bg-gradient-to-r from-sky-900 via-slate-800 to-sky-700
               px-2 sm:px-3 py-1.5 sm:py-2
               text-slate-50
               dark:border-slate-700 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800"
      >
        <!-- Date -->
        <div class="flex-1 min-w-[120px] max-w-[150px]">
          <label class="mb-0.5 block text-[10px] font-medium text-sky-100">
            {{ t('dateLabel') }}
          </label>
          <input
            v-model="selectedDate"
            type="date"
            class="w-full rounded-lg border border-sky-400 bg-sky-900/40 px-2 py-1
                   text-[11px] text-sky-50 outline-none
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <!-- Status -->
        <div class="flex-1 min-w-[130px] max-w-[170px]">
          <label class="mb-0.5 block text-[10px] font-medium text-sky-100">
            {{ t('statusLabel') }}
          </label>
          <select
            v-model="statusFilter"
            class="w-full rounded-lg border border-sky-400 bg-sky-900/40 px-2 py-1
                   text-[11px] text-sky-50 outline-none
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            <option
              v-for="opt in statusOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Search -->
        <div class="flex-[1.6] min-w-[180px] max-w-md">
          <!-- hide label on very small screen to save vertical space -->
          <label class="mb-0.5 hidden text-[10px] font-medium text-sky-100 sm:block">
            {{ t('searchPlaceholder') }}
          </label>
          <div
            class="flex items-center rounded-lg border border-sky-400 bg-sky-900/40
                   px-2 py-1 text-[11px]
                   dark:border-slate-600 dark:bg-slate-900"
          >
            <i class="fa-solid fa-magnifying-glass mr-1.5 text-[11px] text-sky-200/80 dark:text-slate-300" />
            <input
              v-model="qSearch"
              type="text"
              :placeholder="t('searchPlaceholder')"
              class="flex-1 bg-transparent text-[11px] text-sky-50 outline-none
                     placeholder:text-sky-300/70
                     dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        <!-- Language toggle -->
        <div class="ml-auto flex items-center gap-1 mt-1 sm:mt-0">
          <button
            type="button"
            class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition
                   border border-slate-200/60"
            :class="lang === 'km'
              ? 'bg-amber-300 text-slate-900'
              : 'bg-slate-900/40 text-slate-100'"
            @click="lang = 'km'"
          >
            ខ្មែរ
          </button>
          <button
            type="button"
            class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition
                   border border-slate-200/60"
            :class="lang === 'en'
              ? 'bg-amber-300 text-slate-900'
              : 'bg-slate-900/40 text-slate-100'"
            @click="lang = 'en'"
          >
            EN
          </button>
        </div>
      </div>

      <!-- BODY -->
      <div class="px-3 pb-3 pt-3">
        <!-- error banner -->
        <div
          v-if="error"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ error }}
        </div>

        <!-- loading skeleton -->
        <div v-if="loading" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800"></div>
          <div
            v-for="i in 3"
            :key="'sk-' + i"
            class="h-16 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/80"
          ></div>
        </div>

        <div v-else>
          <!-- MOBILE: CARD LIST -->
          <div v-if="isMobile" class="driver-card-wrap">
            <p
              v-if="!paged.length"
              class="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
            >
              {{ t('noBookings') }}
              <span v-if="selectedDate"> {{ lang === 'km' ? 'នៅថ្ងៃទី' : 'on' }} {{ selectedDate }}</span>។
            </p>

            <div v-else class="driver-card-list">
              <article
                v-for="item in paged"
                :key="item._id"
                :data-row-id="item._id"
                class="driver-card rounded-2xl border border-slate-300 bg-white/95 p-3 text-xs
                       shadow-[0_10px_24px_rgba(15,23,42,0.16)]
                       dark:border-slate-700 dark:bg-slate-900/95"
              >
                <!-- top row -->
                <div class="card-top">
                  <div class="card-top-left">
                    <span
                      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      :class="item.category === 'Car'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100'
                        : 'border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100'"
                    >
                      <i
                        :class="item.category === 'Car'
                          ? 'fa-solid fa-car'
                          : 'fa-solid fa-motorcycle'"
                        class="text-[11px]"
                      />
                      <span>{{ categoryLabel(item.category) }}</span>
                    </span>
                    <div class="card-time mono">
                      {{ item.timeStart }} – {{ item.timeEnd }}
                    </div>
                    <div class="card-date text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.tripDate }}
                    </div>
                  </div>
                  <div class="card-top-right">
                    <span :class="statusBadgeClass(item.status)">
                      <i :class="statusIconClass(item.status)" class="text-[11px]" />
                      <span>{{ statusLabel(item.status) }}</span>
                    </span>
                  </div>
                </div>

                <div class="my-2 h-px bg-slate-200 dark:bg-slate-700" />

                <!-- requester -->
                <div class="card-row">
                  <div class="lbl">{{ t('requester') }}</div>
                  <div class="val">
                    {{ item.employee?.name || '—' }}
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                    </div>
                  </div>
                </div>

                <!-- destination -->
                <div class="card-row">
                  <div class="lbl">{{ t('destination') }}</div>
                  <div class="val">
                    <div class="truncate-2">
                      {{ prettyStops(item.stops) }}
                    </div>
                    <div v-if="item.ticketUrl" class="mt-1">
                      <a
                        :href="absUrl(item.ticketUrl)"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 text-[11px] text-indigo-700 underline
                               dark:text-indigo-300"
                      >
                        <i class="fa-solid fa-paperclip text-[11px]" />
                        <span>{{ t('ticket') }}</span>
                      </a>
                    </div>
                  </div>
                </div>

                <!-- passengers -->
                <div class="card-row small">
                  <div class="lbl">{{ t('passengers') }}</div>
                  <div class="val">
                    {{ item.passengers ?? 1 }}
                  </div>
                </div>

                <!-- ack -->
                <div class="card-row small">
                  <div class="lbl">{{ roleLabel }}</div>
                  <div class="val">
                    <span
                      :class="ackBadgeClass(item.assignment?.driverAck || 'PENDING')"
                    >
                      <i
                        :class="ackIconClass(item.assignment?.driverAck || 'PENDING')"
                        class="text-[11px]"
                      />
                      <span>
                        {{ ackLabel(item.assignment?.driverAck || 'PENDING') }}
                      </span>
                    </span>
                  </div>
                </div>

                <!-- purpose / notes -->
                <div v-if="item.purpose" class="card-row">
                  <div class="lbl">{{ t('purpose') }}</div>
                  <div class="val">{{ item.purpose }}</div>
                </div>
                <div v-if="item.notes" class="card-row">
                  <div class="lbl">{{ t('notes') }}</div>
                  <div class="val whitespace-pre-wrap">{{ item.notes }}</div>
                </div>

                <!-- actions -->
                <div class="card-actions-row">
                  <button
                    v-if="canRespond(item)"
                    type="button"
                    class="inline-flex w-full items-center justify-center gap-1 rounded-full
                           bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white
                           hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="actLoading === String(item._id)"
                    @click.stop="sendAck(item,'ACCEPTED')"
                  >
                    <i class="fa-solid fa-check text-[11px]" />
                    <span>{{ t('agree') }}</span>
                  </button>

                  <div
                    v-if="canChangeStatus(item)"
                    class="mt-1 flex flex-wrap gap-1"
                  >
                    <span class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ t('nextStatuses') }}:
                    </span>
                    <button
                      v-for="s in nextStatusesFor(item.status)"
                      :key="s"
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-sky-500
                             bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900
                             hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60
                             dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
                      :disabled="statusLoading === String(item._id)"
                      @click.stop="setDriverStatus(item, s)"
                    >
                      <i :class="statusIconClass(s)" class="text-[11px]" />
                      <span>{{ statusLabel(s) }}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    class="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-full
                           border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px]
                           font-medium text-slate-700 hover:bg-slate-100
                           dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    @click.stop="showDetails(item)"
                  >
                    <i class="fa-solid fa-circle-info text-[11px]" />
                    <span>{{ t('details') }}</span>
                  </button>
                </div>
              </article>
            </div>

            <!-- mobile footer / pagination -->
            <div
              v-if="paged.length"
              class="table-footer mobile-footer mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300"
            >
              <div class="tf-left">
                {{ rangeStart }}–{{ rangeEnd }} {{ lang === 'km' ? 'នៃ' : 'of' }} {{ totalItems }}
              </div>
              <div class="tf-right flex items-center gap-1">
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page <= 1"
                  @click="page = 1"
                >
                  «
                </button>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page <= 1"
                  @click="page = Math.max(1, page - 1)"
                >
                  Prev
                </button>
                <span class="px-1">
                  Page {{ page }} / {{ pageCount }}
                </span>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page >= pageCount"
                  @click="page = Math.min(pageCount, page + 1)"
                >
                  Next
                </button>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page >= pageCount"
                  @click="page = pageCount"
                >
                  »
                </button>
              </div>
            </div>
          </div>

          <!-- DESKTOP/TABLET: TABLE -->
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full border-collapse border border-slate-300 bg-white text-xs
                     dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <thead>
                <tr class="bg-slate-50 dark:bg-slate-800">
                  <th
                    v-for="h in headers"
                    :key="h.key"
                    class="border-b border-slate-300 px-3 py-2 text-left text-[11px] font-semibold text-slate-700
                           dark:border-slate-700 dark:text-slate-100"
                    :style="{
                      width: h.width ? h.width + 'px' : undefined,
                      textAlign: h.align || 'left',
                    }"
                  >
                    {{ h.title }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in paged"
                  :key="item._id"
                  :data-row-id="item._id"
                  class="border-b border-slate-200 hover:bg-slate-50
                         dark:border-slate-800 dark:hover:bg-slate-900"
                >
                  <!-- time -->
                  <td class="px-3 py-2 align-top">
                    <div class="mono text-[12px]">
                      {{ item.timeStart }} – {{ item.timeEnd }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.tripDate }}
                    </div>
                  </td>

                  <!-- category -->
                  <td class="px-3 py-2 align-top">
                    <span
                      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      :class="item.category === 'Car'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100'
                        : 'border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100'"
                    >
                      <i
                        :class="item.category === 'Car'
                          ? 'fa-solid fa-car'
                          : 'fa-solid fa-motorcycle'"
                        class="text-[11px]"
                      />
                      <span>{{ categoryLabel(item.category) }}</span>
                    </span>
                  </td>

                  <!-- requester -->
                  <td class="px-3 py-2 align-top">
                    <div class="text-[12px] font-semibold">
                      {{ item.employee?.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                    </div>
                  </td>

                  <!-- destination -->
                  <td class="px-3 py-2 align-top">
                    <div class="truncate-2 text-[12px]">
                      {{ prettyStops(item.stops) }}
                    </div>
                    <div v-if="item.ticketUrl" class="mt-1">
                      <a
                        :href="absUrl(item.ticketUrl)"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 text-[11px] text-indigo-700 underline
                               dark:text-indigo-300"
                      >
                        <i class="fa-solid fa-paperclip text-[11px]" />
                        <span>{{ t('ticket') }}</span>
                      </a>
                    </div>
                  </td>

                  <!-- passengers -->
                  <td class="px-3 py-2 text-center align-top">
                    {{ item.passengers ?? 1 }}
                  </td>

                  <!-- status -->
                  <td class="px-3 py-2 align-top text-right">
                    <span :class="statusBadgeClass(item.status)">
                      <i :class="statusIconClass(item.status)" class="text-[11px]" />
                      <span>{{ statusLabel(item.status) }}</span>
                    </span>
                  </td>

                  <!-- driver ack -->
                  <td class="px-3 py-2 align-top text-right">
                    <span
                      :class="ackBadgeClass(item.assignment?.driverAck || 'PENDING')"
                    >
                      <i
                        :class="ackIconClass(item.assignment?.driverAck || 'PENDING')"
                        class="text-[11px]"
                      />
                      <span>
                        {{ ackLabel(item.assignment?.driverAck || 'PENDING') }}
                      </span>
                    </span>
                  </td>

                  <!-- actions -->
                  <td class="px-3 py-2 align-top text-right">
                    <div class="flex flex-wrap justify-end gap-1">
                      <button
                        v-if="canRespond(item)"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-600
                               px-3 py-1.5 text-[11px] font-semibold text-white
                               hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="actLoading === String(item._id)"
                        @click.stop="sendAck(item,'ACCEPTED')"
                      >
                        <i class="fa-solid fa-check text-[11px]" />
                        <span>{{ t('agree') }}</span>
                      </button>

                      <template v-if="canChangeStatus(item)">
                        <span class="self-center text-[11px] text-slate-500 dark:text-slate-400">
                          →
                        </span>
                        <button
                          v-for="s in nextStatusesFor(item.status)"
                          :key="s"
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-sky-500
                                 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900
                                 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60
                                 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
                          :disabled="statusLoading === String(item._id)"
                          @click.stop="setDriverStatus(item, s)"
                        >
                          <i :class="statusIconClass(s)" class="text-[11px]" />
                          <span>{{ statusLabel(s) }}</span>
                        </button>
                      </template>

                      <button
                        type="button"
                        class="ml-1 inline-flex items-center gap-1 rounded-full border border-slate-300
                               bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700
                               hover:bg-slate-100
                               dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        @click.stop="showDetails(item)"
                      >
                        <i class="fa-solid fa-circle-info text-[11px]" />
                        <span>{{ t('details') }}</span>
                      </button>
                    </div>
                  </td>
                </tr>

                <tr v-if="!paged.length">
                  <td
                    colspan="8"
                    class="px-3 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400"
                  >
                    {{ t('noBookings') }}
                    <span v-if="selectedDate"> {{ lang === 'km' ? 'នៅថ្ងៃទី' : 'on' }} {{ selectedDate }}</span>។
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- desktop footer -->
            <div
              v-if="paged.length"
              class="mt-2 flex items-center justify-between border-t border-slate-200
                     px-3 py-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300"
            >
              <div>
                {{ rangeStart }}–{{ rangeEnd }} {{ lang === 'km' ? 'នៃ' : 'of' }} {{ totalItems }}
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page <= 1"
                  @click="page = 1"
                >
                  «
                </button>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page <= 1"
                  @click="page = Math.max(1, page - 1)"
                >
                  Prev
                </button>
                <span class="px-1">
                  Page {{ page }} / {{ pageCount }}
                </span>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page >= pageCount"
                  @click="page = Math.min(pageCount, page + 1)"
                >
                  Next
                </button>
                <button
                  type="button"
                  class="pagination-btn"
                  :disabled="page >= pageCount"
                  @click="page = pageCount"
                >
                  »
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- DETAILS MODAL -->
      <div
        v-if="detailOpen && detailItem"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-3"
        @click.self="closeDetails"
      >
        <div
          class="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-300
                 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span
                class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                :class="detailItem?.category === 'Car'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100'
                  : 'border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100'"
              >
                <i
                  :class="detailItem?.category === 'Car'
                    ? 'fa-solid fa-car'
                    : 'fa-solid fa-motorcycle'"
                  class="text-[11px]"
                />
                <span>{{ categoryLabel(detailItem?.category || '') || '—' }}</span>
              </span>
              <span class="mono text-[12px]">
                {{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}
              </span>
            </div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100
                     dark:text-slate-300 dark:hover:bg-slate-800"
              @click="closeDetails"
            >
              <i class="fa-solid fa-xmark text-xs" />
            </button>
          </div>

          <div class="max-h-[70vh] overflow-y-auto px-4 py-3 text-xs">
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="lbl">{{ t('dateLabel') }}</div>
                <div class="val">{{ detailItem?.tripDate || '—' }}</div>
              </div>
              <div>
                <div class="lbl">{{ t('passengers') }}</div>
                <div class="val">{{ detailItem?.passengers ?? 1 }}</div>
              </div>

              <div>
                <div class="lbl">{{ t('requester') }}</div>
                <div class="val">
                  {{ detailItem?.employee?.name || '—' }}
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ detailItem?.employee?.department || '—' }} • ID {{ detailItem?.employeeId }}
                  </div>
                </div>
              </div>

              <div>
                <div class="lbl">{{ t('statusLabel') }}</div>
                <div class="mt-1">
                  <span :class="statusBadgeClass(detailItem?.status)">
                    <i :class="statusIconClass(detailItem?.status)" class="text-[11px]" />
                    <span>{{ statusLabel(detailItem?.status || '—') }}</span>
                  </span>
                </div>
              </div>
            </div>

            <div class="mt-3">
              <div class="lbl">{{ t('routeTitle') }}</div>
              <div class="val">
                <div
                  v-if="(detailItem?.stops || []).length"
                  class="mt-1 flex flex-col gap-1"
                >
                  <div
                    v-for="(s,i) in detailItem?.stops"
                    :key="i"
                    class="flex flex-wrap items-center gap-2 text-[12px]"
                  >
                    <i
                      :class="s.destination === 'Airport'
                        ? 'fa-solid fa-plane-departure'
                        : 'fa-solid fa-location-dot'"
                      class="text-[11px] text-slate-600 dark:text-slate-300"
                    />
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ destText(s) }}</span>
                    <a
                      v-if="s.mapLink"
                      :href="absUrl(s.mapLink)"
                      target="_blank"
                      rel="noopener"
                      class="ml-1 inline-flex items-center gap-1 text-[11px] text-sky-700 underline
                             dark:text-sky-300"
                    >
                      <i class="fa-solid fa-link text-[11px]" />
                      <span>Map</span>
                    </a>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </div>

            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div v-if="detailItem?.purpose">
                <div class="lbl">{{ t('purpose') }}</div>
                <div class="val">{{ detailItem.purpose }}</div>
              </div>
              <div v-if="detailItem?.notes">
                <div class="lbl">{{ t('notes') }}</div>
                <div class="val whitespace-pre-wrap">{{ detailItem.notes }}</div>
              </div>
            </div>

            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div class="lbl">{{ t('driverResponse') }}</div>
                <div class="mt-1">
                  <span
                    :class="ackBadgeClass(detailItem?.assignment?.driverAck || 'PENDING')"
                  >
                    <i
                      :class="ackIconClass(detailItem?.assignment?.driverAck || 'PENDING')"
                      class="text-[11px]"
                    />
                    <span>
                      {{ ackLabel(detailItem?.assignment?.driverAck || 'PENDING') }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            class="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2
                   dark:border-slate-700"
          >
            <button
              v-if="detailItem && canRespond(detailItem)"
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600
                     px-3 py-1.5 text-[11px] font-semibold text-white
                     hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="actLoading === String(detailItem?._id)"
              @click="sendAck(detailItem,'ACCEPTED')"
            >
              <i class="fa-solid fa-check text-[11px]" />
              <span>{{ t('agree') }}</span>
            </button>

            <div v-if="detailItem && canChangeStatus(detailItem)" class="flex flex-wrap gap-1">
              <span class="self-center text-[11px] text-slate-500 dark:text-slate-400">
                {{ t('nextStatuses') }}:
              </span>
              <button
                v-for="s in nextStatusesFor(detailItem.status)"
                :key="s"
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-sky-500
                       bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900
                       hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60
                       dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
                :disabled="statusLoading === String(detailItem?._id)"
                @click.stop="setDriverStatus(detailItem, s)"
              >
                <i :class="statusIconClass(s)" class="text-[11px]" />
                <span>{{ statusLabel(s) }}</span>
              </button>
            </div>

            <button
              type="button"
              class="ml-2 inline-flex items-center gap-1 rounded-full border border-slate-300
                     bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700
                     hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              @click="closeDetails"
            >
              <i class="fa-solid fa-xmark text-[11px]" />
              <span>{{ t('close') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap');

.driver-shell {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* highlight from calendar focus */
.highlight-row {
  animation: rowFlash 2.5s ease-in-out;
}
@keyframes rowFlash {
  0% {
    background-color: #e0f2fe;
  }
  100% {
    background-color: transparent;
  }
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    'Liberation Mono', monospace;
}
.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* labels */
.lbl {
  font-size: 0.78rem;
  color: #64748b;
}
.val {
  font-weight: 600;
}

/* mobile cards */
.driver-card-wrap {
  margin-top: 2px;
}
.driver-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.driver-card {
  background: radial-gradient(
    circle at top left,
    #eff6ff 0,
    #ffffff 38%,
    #f8fafc 100%
  );
}
:global(.dark) .driver-card {
  background: radial-gradient(
    circle at top left,
    #020617 0,
    #020617 40%,
    #020617 100%
  );
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.card-top-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-time {
  font-size: 0.9rem;
}
.card-date {
  font-size: 0.78rem;
}
.card-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 6px;
}
.card-row.small {
  margin-top: 4px;
}
.card-row .lbl {
  min-width: 82px;
  font-size: 0.78rem;
  color: #64748b;
  padding-top: 2px;
}
.card-row .val {
  font-weight: 500;
  font-size: 0.9rem;
}
.card-actions-row {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* pagination buttons */
.pagination-btn {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid #cbd5f5;
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pagination-btn:not(:disabled):hover {
  background: #e5edff;
}
:global(.dark) .pagination-btn {
  border-color: #475569;
  background: #020617;
  color: #e2e8f0;
}
:global(.dark) .pagination-btn:not(:disabled):hover {
  background: #0f172a;
}

/* mobile footer stack */
@media (max-width: 640px) {
  .table-footer.mobile-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* dark tweak for labels */
:global(.dark) .lbl {
  color: #9ca3af;
}
</style>
