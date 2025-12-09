<!-- src/views/admin/carbooking/AdminCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const { showToast } = useToast()

/* ───────── Responsive (no Vuetify) ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Base state ───────── */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate   = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter   = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch        = ref('')

const updating = ref({}) // { [bookingId]: boolean }

/* focus from calendar (highlight row/card) */
const focusId = computed(() => String(route.query.focus || ''))

/* ───────── Workflow transitions (aligned with driver/backend) ───────── */
/**
 * Main path:
 * PENDING → ACCEPTED → ON_ROAD → ARRIVING → COMEBACK → COMPLETED
 * DELAYED/CANCELLED are side branches.
 */
const ALLOWED_NEXT = {
  PENDING   : ['ACCEPTED', 'CANCELLED'],
  ACCEPTED  : ['ON_ROAD', 'DELAYED', 'CANCELLED'],
  ON_ROAD   : ['ARRIVING', 'DELAYED', 'COMEBACK', 'CANCELLED'],
  ARRIVING  : ['COMEBACK', 'DELAYED', 'CANCELLED'],   // no COMPLETED here
  COMEBACK  : ['COMPLETED', 'DELAYED', 'CANCELLED'],  // complete only after COMEBACK
  COMPLETED : [],
  DELAYED   : ['ON_ROAD', 'ARRIVING', 'COMEBACK', 'CANCELLED'],
  CANCELLED : [],
}
const nextStatuses = (from) =>
  ALLOWED_NEXT[String(from || '').toUpperCase()] || []

/* Time helpers for edit dialog */
const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

/* Helpers */
const API_ORIGIN = (api.defaults.baseURL || '')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '')

const absUrl = (u) =>
  !u
    ? ''
    : /^https?:\/\//i.test(u)
      ? u
      : `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`

const openTicket = (u) => {
  const url = absUrl(u)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

/* Destinations */
function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination)
    .join(' → ')
}

/* Assignee helpers */
const assigneeName = (it) => {
  if (!it?.assignment) return ''
  if (it?.category === 'Messenger') {
    return it.assignment.messengerName || it.assignment.messengerId || ''
  }
  return it.assignment.driverName || it.assignment.driverId || ''
}
const hasAssignee = (it) => {
  if (!it?.assignment) return false
  if (it.category === 'Messenger') return !!it.assignment.messengerId
  return !!it.assignment.driverId
}

/* ───────── Status / badges (Tailwind) ───────── */
const STATUS_BADGE_CLASS = {
  PENDING   : 'bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-slate-900',
  ACCEPTED  : 'bg-sky-500 text-white',
  ON_ROAD   : 'bg-cyan-500 text-white',
  ARRIVING  : 'bg-emerald-500 text-white',
  COMPLETED : 'bg-green-600 text-white',
  COMEBACK  : 'bg-indigo-500 text-white', // comeback trip
  DELAYED   : 'bg-amber-400 text-slate-900',
  CANCELLED : 'bg-red-500 text-white',
}
const statusBadgeClass = s =>
  STATUS_BADGE_CLASS[String(s || '').toUpperCase()] ||
  'bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-slate-900'

const ACK_BADGE_CLASS = {
  PENDING  : 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-50',
  ACCEPTED : 'bg-emerald-500 text-white',
  DECLINED : 'bg-red-500 text-white',
}
const ackBadgeClass = s =>
  ACK_BADGE_CLASS[String(s || '').toUpperCase()] ||
  'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-50'

/** Driver / messenger response label for current booking */
const responseLabel = (item) => {
  if (!item || !item.assignment) return 'PENDING'
  if (item.category === 'Messenger') {
    return item.assignment.messengerAck || 'PENDING'
  }
  return item.assignment.driverAck || 'PENDING'
}

const categoryBadgeClass = cat =>
  cat === 'Messenger'
    ? 'bg-orange-500 text-white'
    : 'bg-indigo-500 text-white'

const paxDisplay = p => (p ?? 1)

/* ───────── Status action button appearance ───────── */
const STATUS_ACTION_BTN_CLASS = {
  PENDING   : 'border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100',
  ACCEPTED  : 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100',
  ON_ROAD   : 'border-cyan-500 bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
  ARRIVING  : 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  COMEBACK  : 'border-indigo-500 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  COMPLETED : 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100',
  DELAYED   : 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100',
  CANCELLED : 'border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100',
}

/** Unique pill style for status-change buttons (different from Edit/Assign) */
const statusButtonClass = (s) => {
  const base =
    'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors'
  const variant =
    STATUS_ACTION_BTN_CLASS[String(s || '').toUpperCase()] ||
    'border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100'
  return `${base} ${variant}`
}

/* ───────── Search / filter / sort ───────── */
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => !selectedDate.value || r.tripDate === selectedDate.value)
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => statusFilter.value === 'ALL' || r.status === statusFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name,
        r.employee?.department,
        r.employeeId,
        r.purpose,
        prettyStops(r.stops),
        assigneeName(r),
        r.assignment?.driverAck,
        r.assignment?.messengerAck,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(term)
    })
    .sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

/* ───────── Pagination ───────── */
const page = ref(1)
const itemsPerPage = ref(10)
const PER_PAGE_OPTIONS = [10, 20, 50]

const totalItems = computed(() => filtered.value.length)

const pageCount = computed(() => {
  const per = itemsPerPage.value || 10
  if (per <= 0) return 1
  const n = Math.ceil(totalItems.value / per)
  return Math.max(1, n || 1)
})

const visibleRows = computed(() => {
  const per = itemsPerPage.value || 10
  const start = (page.value - 1) * per
  return filtered.value.slice(start, start + per)
})

const rangeStart = computed(() =>
  totalItems.value ? (page.value - 1) * (itemsPerPage.value || 10) + 1 : 0
)
const rangeEnd = computed(() =>
  Math.min(page.value * (itemsPerPage.value || 10), totalItems.value)
)

watch([filtered, itemsPerPage], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

/* ───────── API load ───────── */
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
      assignment: x.assignment || {},
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
    showToast({
      type: 'error',
      title: 'Load failed',
      message: error.value,
    })
  } finally {
    loading.value = false
  }
}

/* ───────── Realtime socket handlers ───────── */
function onCreated(doc) {
  if (doc?.tripDate && selectedDate.value && doc.tripDate !== selectedDate.value) return
  loadSchedule()
}

function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it && p?.status) it.status = p.status
}

function onAssigned(p) {
  const it = rows.value.find(
    (x) => String(x._id) === String(p?.bookingId),
  )
  if (!it) return

  it.assignment = {
    ...(it.assignment || {}),
    driverId:       p.driverId       ?? it.assignment?.driverId,
    driverName:     p.driverName     ?? it.assignment?.driverName,
    messengerId:    p.messengerId    ?? it.assignment?.messengerId,
    messengerName:  p.messengerName  ?? it.assignment?.messengerName,
    driverAck:      it.assignment?.driverAck      || 'PENDING',
    messengerAck:   it.assignment?.messengerAck   || 'PENDING',
  }

  // trust backend if it sends a status
  if (p.status) {
    it.status = p.status
  } else if (it.status === 'PENDING') {
    // fallback: after admin assign, show ACCEPTED
    it.status = 'ACCEPTED'
  }
}

/**
 * When driver accepts/declines, Admin view should reflect:
 * - ACK badge
 * - Status becomes ACCEPTED when ACK = ACCEPTED (if still PENDING)
 */
function onDriverAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return

  const resp = String(p?.response || '').toUpperCase()

  it.assignment = {
    ...(it.assignment || {}),
    driverAck: resp,
    driverAckAt: p?.at,
  }

  if (resp === 'ACCEPTED' && String(it.status).toUpperCase() === 'PENDING') {
    it.status = 'ACCEPTED'
  }

  if (resp === 'DECLINED' && String(it.status).toUpperCase() === 'ACCEPTED') {
    it.status = 'PENDING'
  }
}

/**
 * Messenger ACK flows similarly, but only changes status automatically
 * for Messenger category.
 */
function onMessengerAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return

  const resp = String(p?.response || '').toUpperCase()

  it.assignment = {
    ...(it.assignment || {}),
    messengerAck: resp,
    messengerAckAt: p?.at,
  }

  if (
    it.category === 'Messenger' &&
    resp === 'ACCEPTED' &&
    String(it.status).toUpperCase() === 'PENDING'
  ) {
    it.status = 'ACCEPTED'
  }

  if (
    it.category === 'Messenger' &&
    resp === 'DECLINED' &&
    String(it.status).toUpperCase() === 'ACCEPTED'
  ) {
    it.status = 'PENDING'
  }
}

function onUpdated(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return
  Object.assign(it, p?.patch || {})
}

function onDeleted(p) {
  const id = String(p?.bookingId || '')
  if (!id) return
  rows.value = rows.value.filter(x => String(x._id) !== id)
}

/* ───────── Lifecycle ───────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }

  try { subscribeRoleIfNeeded({ role: 'ADMIN' }) } catch {}

  if (route.query.date) {
    const dStr = dayjs(route.query.date).isValid()
      ? dayjs(route.query.date).format('YYYY-MM-DD')
      : String(route.query.date)
    selectedDate.value = dStr
  }

  loadSchedule()

  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
  socket.on('carBooking:assigned', onAssigned)
  socket.on('carBooking:driverAck', onDriverAck)
  socket.on('carBooking:messengerAck', onMessengerAck)
  socket.on('carBooking:updated', onUpdated)
  socket.on('carBooking:deleted', onDeleted)
})

onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
  socket.off('carBooking:assigned', onAssigned)
  socket.off('carBooking:driverAck', onDriverAck)
  socket.off('carBooking:messengerAck', onMessengerAck)
  socket.off('carBooking:updated', onUpdated)
  socket.off('carBooking:deleted', onDeleted)

  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
})

watch([selectedDate, statusFilter, categoryFilter], () => {
  page.value = 1
  loadSchedule()
})

watch(
  () => route.query.date,
  (val) => {
    if (!val) return
    const dStr = dayjs(val).isValid()
      ? dayjs(val).format('YYYY-MM-DD')
      : String(val)
    selectedDate.value = dStr
  }
)

/* ───────── Details modal ───────── */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item) {
  detailItem.value = item
  detailOpen.value = true
}

/* ───────── Assign flow ───────── */
const assignOpen    = ref(false)
const assignTarget  = ref(null)
const assignLoading = ref(false)
const assignError   = ref('')

const assignRole       = ref('DRIVER')
const assignLockedRole = ref('DRIVER')
const people           = ref([])
const selectedLoginId  = ref('')

const busyMap = ref(new Map())
const isBusy = (loginId) => {
  const v = busyMap.value.get(String(loginId))
  if (!v) return false
  return v.busy && String(v.status || '').toUpperCase() !== 'COMPLETED'
}

async function fetchFirstOk(requests) {
  for (const r of requests) {
    try {
      const res = await r()
      if (Array.isArray(res?.data)) return res.data
    } catch {}
  }
  return []
}

async function loadPeopleAndAvailability(item) {
  people.value = []
  busyMap.value = new Map()

  const currentLoginId = assignRole.value === 'MESSENGER'
    ? item?.assignment?.messengerId
    : item?.assignment?.driverId

  selectedLoginId.value = currentLoginId || ''
  const role = assignRole.value

  const list = await fetchFirstOk([
    () => api.get(role === 'DRIVER' ? '/admin/drivers' : '/admin/messengers'),
    () => api.get('/admin/users', { params: { role } }),
  ])

  people.value = list.map(u => ({
    _id: String(u._id || u.id || u.loginId),
    loginId: String(u.loginId || ''),
    name: u.name || u.fullName || u.loginId || '—',
  }))

  try {
    const { data } = await api.get('/admin/availability/assignees', {
      params: {
        role,
        date: item.tripDate,
        start: item.timeStart,
        end: item.timeEnd,
      },
    })
    const m = new Map()
    if (Array.isArray(data)) {
      for (const v of data) m.set(String(v), { busy: true, status: '' })
    } else if (data && Array.isArray(data.busy)) {
      for (const v of data.busy) {
        if (typeof v === 'string') {
          m.set(String(v), { busy: true, status: '' })
        } else if (v && v.loginId) {
          const stat = String(v.status || '').toUpperCase()
          const consideredBusy = stat !== 'COMPLETED'
          m.set(String(v.loginId), { busy: consideredBusy, status: stat })
        }
      }
    }
    busyMap.value = m
  } catch {
    busyMap.value = new Map()
  }
}

function openAssignDialog(item) {
  assignTarget.value = item
  assignError.value  = ''

  const locked = item?.category === 'Messenger' ? 'MESSENGER' : 'DRIVER'
  assignLockedRole.value = locked
  assignRole.value       = locked

  assignOpen.value = true
  loadPeopleAndAvailability(item)
}

watch(assignRole, () => {
  if (assignOpen.value && assignTarget.value?._id) {
    loadPeopleAndAvailability(assignTarget.value)
  }
})

async function submitAssign() {
  if (!assignTarget.value?._id) return

  if (!selectedLoginId.value) {
    assignError.value = 'Please select one person.'
    showToast({
      type: 'warning',
      title: 'Missing selection',
      message: 'Please select a person to assign.',
    })
    return
  }

  if (isBusy(selectedLoginId.value)) {
    assignError.value = 'This person is busy in this window.'
    showToast({
      type: 'warning',
      title: 'Unavailable',
      message: 'This person is busy in this time window.',
    })
    return
  }

  assignLoading.value = true
  assignError.value = ''
  try {
    await api.post(`/admin/car-bookings/${assignTarget.value._id}/assign`, {
      driverId: selectedLoginId.value,
      role: assignRole.value,
      status: 'ACCEPTED',       // admin assignment = booking accepted
    })

    const it = rows.value.find(
      x => String(x._id) === String(assignTarget.value._id),
    )

    if (it) {
      if (assignRole.value === 'MESSENGER') {
        it.assignment = {
          ...(it.assignment || {}),
          messengerId: selectedLoginId.value,
          messengerAck: 'PENDING',
        }
      } else {
        it.assignment = {
          ...(it.assignment || {}),
          driverId: selectedLoginId.value,
          driverAck: 'PENDING',
        }
      }

      it.status = 'ACCEPTED'
    }

    assignOpen.value = false
    showToast({
      type: 'success',
      title: 'Assigned',
      message: 'Booking assigned and accepted by admin.',
    })
  } catch (e) {
    assignError.value = e?.response?.data?.message || e?.message || 'Failed to assign'
    showToast({
      type: 'error',
      title: 'Assign failed',
      message: assignError.value,
    })
  } finally {
    assignLoading.value = false
  }
}

/* ───────── Status update ───────── */
async function updateStatus(item, nextStatus) {
  if (!item?._id || !nextStatus) return
  const allowed = nextStatuses(item.status)
  if (!allowed.includes(nextStatus)) {
    const msg = `Cannot change from ${item.status} to ${nextStatus}`
    error.value = msg
    showToast({
      type: 'warning',
      title: 'Invalid transition',
      message: msg,
    })
    return
  }

  updating.value[item._id] = true
  const prevStatus = item.status
  try {
    item.status = nextStatus
    await api.patch(`/admin/car-bookings/${item._id}/status`, { status: nextStatus })
    showToast({
      type: 'success',
      title: 'Status updated',
      message: `Booking status: ${prevStatus} → ${nextStatus}`,
    })
  } catch (e) {
    await loadSchedule()
    error.value = e?.response?.data?.message || e?.message || 'Failed to update status'
    showToast({
      type: 'error',
      title: 'Update failed',
      message: error.value,
    })
  } finally {
    updating.value[item._id] = false
  }
}

/* ───────── Edit schedule (date / time / category) ───────── */
const editOpen   = ref(false)
const editTarget = ref(null)
const editForm   = ref({
  tripDate: '',
  timeStartHour: '',
  timeStartMinute: '',
  timeEndHour: '',
  timeEndMinute: '',
  category: 'Car',
})
const editLoading = ref(false)
const editError   = ref('')

function openEditDialog(item) {
  editTarget.value = item
  editError.value  = ''

  const [sh, sm] = (item.timeStart || '08:00').split(':')
  const [eh, em] = (item.timeEnd || '09:00').split(':')

  editForm.value = {
    tripDate: item.tripDate || selectedDate.value,
    timeStartHour: sh,
    timeStartMinute: sm,
    timeEndHour: eh,
    timeEndMinute: em,
    category: item.category || 'Car',
  }

  editOpen.value = true
}

async function saveEdit() {
  if (!editTarget.value?._id) return

  editError.value = ''

  const timeStart = `${editForm.value.timeStartHour}:${editForm.value.timeStartMinute}`
  const timeEnd   = `${editForm.value.timeEndHour}:${editForm.value.timeEndMinute}`

  if (timeEnd <= timeStart) {
    editError.value = 'End time must be after start time.'
    showToast({
      type: 'warning',
      title: 'Invalid time',
      message: editError.value,
    })
    return
  }

  const old = editTarget.value
  const payload = {
    tripDate: editForm.value.tripDate,
    timeStart,
    timeEnd,
    category: editForm.value.category,
  }

  const scheduleChanged =
    old.tripDate  !== payload.tripDate ||
    old.timeStart !== payload.timeStart ||
    old.timeEnd   !== payload.timeEnd ||
    old.category  !== payload.category

  const needReopen = scheduleChanged && old.status !== 'PENDING'

  editLoading.value = true
  try {
    await api.patch(`/admin/car-bookings/${old._id}`, payload)

    const it = rows.value.find(x => String(x._id) === String(old._id))
    if (it) {
      it.tripDate  = payload.tripDate
      it.timeStart = payload.timeStart
      it.timeEnd   = payload.timeEnd
      it.category  = payload.category
    }

    if (needReopen) {
      await api.patch(`/admin/car-bookings/${old._id}/status`, {
        status: 'PENDING',
        forceReopen: true,
      })

      if (it) {
        it.status = 'PENDING'
        if (!it.assignment) it.assignment = {}
        it.assignment.driverAck = 'PENDING'
        it.assignment.messengerAck = 'PENDING'
      }
    }

    editOpen.value = false
    await loadSchedule()

    showToast({
      type: 'success',
      title: 'Schedule updated',
      message: 'Booking schedule has been updated.',
    })
  } catch (e) {
    editError.value = e?.response?.data?.message || e?.message || 'Failed to update schedule'
    showToast({
      type: 'error',
      title: 'Update failed',
      message: editError.value,
    })
  } finally {
    editLoading.value = false
  }
}
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100 admin-car-page">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Header bar -->
      <div
        class="rounded-t-2xl border-b border-slate-200 bg-gradient-to-r
               from-[#0f719e] via-[#b3b4df] to-[#ae9aea]
               px-3 py-2 text-slate-900
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 dark:text-slate-100"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-col leading-tight">
            <span
              class="text-[10px] font-semibold uppercase tracking-[0.24em]
                     text-slate-800/80 dark:text-slate-200/80"
            >
              Car Booking
            </span>
            <span class="text-sm font-semibold">
              Admin car &amp; messenger schedule
            </span>
          </div>
          <div class="flex flex-col items-end text-[11px] text-slate-900/80 dark:text-slate-100/80">
            <span>
              Date: {{ selectedDate || '—' }}
            </span>
            <span>
              Total bookings: {{ totalItems }}
            </span>
          </div>
        </div>
      </div>

      <!-- Filters row -->
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50
               px-2 py-2 sm:px-3
               dark:border-slate-700 dark:bg-slate-900/80"
      >
        <!-- Date -->
        <input
          v-model="selectedDate"
          type="date"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />

        <!-- Status -->
        <select
          v-model="statusFilter"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="ACCEPTED">ACCEPTED</option>
          <option value="ON_ROAD">ON_ROAD</option>
          <option value="ARRIVING">ARRIVING</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="COMEBACK">COMEBACK</option>
          <option value="DELAYED">DELAYED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>

        <!-- Category -->
        <select
          v-model="categoryFilter"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="ALL">All categories</option>
          <option value="Car">Car</option>
          <option value="Messenger">Messenger</option>
        </select>

        <!-- Search -->
        <input
          v-model="qSearch"
          type="text"
          placeholder="Search requester / purpose / destination / assignee / response"
          class="h-8 w-full max-w-xs flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900 placeholder-slate-400
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
        />

        <!-- Rows per page -->
        <select
          v-model.number="itemsPerPage"
          class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs
                 text-slate-900
                 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option
            v-for="opt in PER_PAGE_OPTIONS"
            :key="opt"
            :value="opt"
          >
            {{ opt }}/page
          </option>
        </select>

        <!-- Refresh -->
        <button
          type="button"
          class="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100
                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          :disabled="loading"
          @click="loadSchedule"
        >
          <span
            v-if="loading"
            class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-slate-500 border-t-transparent"
          />
          Refresh
        </button>
      </div>

      <!-- Error banner -->
      <div
        v-if="error"
        class="mx-3 mt-2 rounded-md border border-rose-500 bg-rose-50 px-3 py-2
               text-[11px] text-rose-700
               dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ error }}
      </div>

      <!-- Content -->
      <div class="px-2 py-2 sm:px-3 sm:py-3">
        <!-- MOBILE: CARD VIEW -->
        <div v-if="isMobile" class="mobile-list">
          <div
            v-if="loading"
            class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Loading bookings…
          </div>

          <div
            v-else-if="!visibleRows.length"
            class="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
          </div>

          <div
            v-else
            v-for="item in visibleRows"
            :key="item._id"
            class="booking-card"
            :class="{
              'ring-2 ring-amber-400': focusId === String(item._id)
            }"
          >
            <!-- top: date/time + status -->
            <div class="bc-top">
              <div>
                <div class="bc-date">
                  {{ item.tripDate || selectedDate }}
                </div>
                <div class="bc-time mono">
                  {{ item.timeStart }} – {{ item.timeEnd }}
                </div>
              </div>

              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                :class="statusBadgeClass(item.status)"
              >
                {{ item.status }}
              </span>
            </div>

            <!-- requester + assignee -->
            <div class="bc-middle">
              <div class="bc-requester">
                <div class="bc-req-name">
                  {{ item.employee?.name || '—' }}
                </div>
                <div class="bc-req-meta text-[11px] text-slate-500 dark:text-slate-400">
                  {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                </div>
              </div>

              <div class="bc-assignee">
                <span
                  v-if="assigneeName(item)"
                  class="assignee-chip inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="item.category === 'Messenger'
                    ? 'bg-orange-500 text-white'
                    : 'bg-indigo-500 text-white'"
                >
                  {{ assigneeName(item) }}
                </span>
                <span
                  v-else
                  class="assignee-chip inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                >
                  Unassigned
                </span>
              </div>
            </div>

            <!-- body: destination, purpose, response -->
            <div class="bc-body">
              <div class="lbl">Destination</div>
              <div class="bc-itinerary">
                {{ prettyStops(item.stops) }}
                <button
                  v-if="item.ticketUrl"
                  type="button"
                  class="ml-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  @click.stop="openTicket(item.ticketUrl)"
                >
                  Ticket
                </button>
              </div>

              <div class="lbl mt-2">Purpose</div>
              <div class="purpose-text-mobile">
                {{ item.purpose || '—' }}
              </div>

              <div class="lbl mt-2">Driver / Messenger response</div>
              <div>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="ackBadgeClass(responseLabel(item))"
                >
                  {{ responseLabel(item) }}
                </span>
              </div>
            </div>

            <!-- bottom: pax + actions -->
            <div class="bc-bottom">
              <div class="text-[11px] text-slate-600 dark:text-slate-300">
                Pax: <strong>{{ paxDisplay(item.passengers) }}</strong>
              </div>

              <div class="bc-actions">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click.stop="openEditDialog(item)"
                >
                  Edit
                </button>

                <button
                  v-for="s in nextStatuses(item.status)"
                  :key="s"
                  type="button"
                  :class="[statusButtonClass(s), 'disabled:opacity-50']"
                  :disabled="!hasAssignee(item) || !!updating[item._id]"
                  @click.stop="updateStatus(item, s)"
                >
                  {{ s }}
                </button>

                <button
                  type="button"
                  class="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  @click.stop="openAssignDialog(item)"
                >
                  Assign
                </button>

                <button
                  type="button"
                  class="text-[11px] font-semibold text-slate-700 hover:underline dark:text-slate-200"
                  @click.stop="showDetails(item)"
                >
                  Details
                </button>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div
            class="table-footer mt-2 border-t border-slate-200
                   dark:border-slate-700 dark:bg-slate-900/90"
          >
            <div class="tf-left text-[11px] text-slate-600 dark:text-slate-300">
              {{ page }} / {{ pageCount }}
            </div>
            <div class="tf-middle" />
            <div class="tf-right flex items-center gap-1">
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                :disabled="page <= 1"
                @click="page > 1 && (page = page - 1)"
              >
                Prev
              </button>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                :disabled="page >= pageCount"
                @click="page < pageCount && (page = page + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <!-- DESKTOP TABLE -->
        <div v-else class="overflow-x-auto">
          <table class="min-w-full border-collapse text-[13px]">
            <thead>
              <tr class="bg-slate-100 dark:bg-slate-800">
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Time
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Category
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Requester
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Destination
                </th>
                <th class="border border-slate-300 px-2 py-2 text-center font-semibold dark:border-slate-700">
                  Pax
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Purpose
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Assigned
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Driver / Messenger Resp.
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">
                  Status
                </th>
                <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700 w-60">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-if="loading"
                class="bg-white dark:bg-slate-900"
              >
                <td
                  colspan="10"
                  class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500
                         dark:border-slate-700 dark:text-slate-300"
                >
                  Loading bookings…
                </td>
              </tr>

              <template v-else>
                <template v-for="item in visibleRows" :key="item._id">
                  <tr
                    :class="[
                      'bg-white hover:bg-sky-50 transition-colors dark:bg-slate-900 dark:hover:bg-slate-800',
                      item.tripDate === selectedDate ? 'bg-amber-50/60 dark:bg-amber-900/40' : '',
                      focusId === String(item._id) ? 'ring-2 ring-amber-400' : ''
                    ]"
                  >
                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="mono">
                        {{ item.timeStart }} – {{ item.timeEnd }}
                      </div>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        :class="categoryBadgeClass(item.category)"
                      >
                        {{ item.category || 'Car' }}
                      </span>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="font-semibold">
                        {{ item.employee?.name || '—' }}
                      </div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                      </div>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="text-[12px]">
                        {{ prettyStops(item.stops) }}
                        <button
                          v-if="item.ticketUrl"
                          type="button"
                          class="ml-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100
                                 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                          @click.stop="openTicket(item.ticketUrl)"
                        >
                          Ticket
                        </button>
                      </div>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 text-center align-top dark:border-slate-700">
                      {{ paxDisplay(item.passengers) }}
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="text-[12px]">
                        {{ item.purpose || '—' }}
                      </div>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <span
                        v-if="assigneeName(item)"
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold assignee-chip"
                        :class="item.category === 'Messenger'
                          ? 'bg-orange-500 text-white'
                          : 'bg-indigo-500 text-white'"
                      >
                        {{ assigneeName(item) }}
                      </span>
                      <span
                        v-else
                        class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100 assignee-chip"
                      >
                        Unassigned
                      </span>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        :class="ackBadgeClass(responseLabel(item))"
                      >
                        {{ responseLabel(item) }}
                      </span>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        :class="statusBadgeClass(item.status)"
                      >
                        {{ item.status }}
                      </span>
                    </td>

                    <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
                      <div class="mb-1 flex flex-wrap gap-1">
                        <button
                          v-for="s in nextStatuses(item.status)"
                          :key="s"
                          type="button"
                          :class="[statusButtonClass(s), 'disabled:opacity-50']"
                          :disabled="!hasAssignee(item) || !!updating[item._id]"
                          @click="updateStatus(item, s)"
                        >
                          {{ s }}
                        </button>
                      </div>

                      <div class="mt-1 flex flex-wrap gap-2 text-[11px]">
                        <button
                          type="button"
                          class="font-semibold text-sky-700 hover:underline dark:text-sky-300"
                          @click="openEditDialog(item)"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                          @click="openAssignDialog(item)"
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          class="font-semibold text-slate-700 hover:underline dark:text-slate-200"
                          @click="showDetails(item)"
                        >
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                </template>

                <tr v-if="!visibleRows.length">
                  <td
                    colspan="10"
                    class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500
                           dark:border-slate-700 dark:text-slate-300"
                  >
                    No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
                  </td>
                </tr>
              </template>
            </tbody>
          </table>

          <!-- Pagination -->
          <div
            class="table-footer border-t border-slate-200
                   dark:border-slate-700 dark:bg-slate-900/90"
          >
            <div class="tf-left text-[11px] text-slate-600 dark:text-slate-300">
              Page {{ page }} / {{ pageCount }} •
              Showing
              <span v-if="totalItems === 0">0</span>
              <span v-else>
                {{ rangeStart }} – {{ rangeEnd }}
              </span>
              of {{ totalItems }}
            </div>
            <div class="tf-middle" />
            <div class="tf-right flex items-center gap-1">
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                :disabled="page <= 1"
                @click="page > 1 && (page = page - 1)"
              >
                Prev
              </button>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                :disabled="page >= pageCount"
                @click="page < pageCount && (page = page + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Details modal -->
    <transition name="fade">
      <div
        v-if="detailOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4"
      >
        <div
          class="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="categoryBadgeClass(detailItem?.category || 'Car')"
                >
                  {{ detailItem?.category || 'Car' }}
                </span>
                <span class="mono text-sm text-slate-800 dark:text-slate-100">
                  {{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}
                </span>
              </div>
              <div class="text-[12px] text-slate-500 dark:text-slate-400">
                Date: {{ detailItem?.tripDate || '—' }} • Pax: {{ paxDisplay(detailItem?.passengers) }}
              </div>
            </div>
            <button
              type="button"
              class="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="detailOpen = false"
            >
              ✕
            </button>
          </div>

          <div class="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div class="lbl">Requester</div>
              <div class="val">
                {{ detailItem?.employee?.name || '—' }}
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ detailItem?.employee?.department || '—' }} • ID {{ detailItem?.employeeId }}
                </div>
              </div>
            </div>
            <div>
              <div class="lbl">Driver / Messenger response</div>
              <div class="val">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="ackBadgeClass(responseLabel(detailItem))"
                >
                  {{ responseLabel(detailItem) }}
                </span>
              </div>
            </div>

            <div class="sm:col-span-2">
              <div class="lbl">Destination</div>
              <div class="val">
                <div
                  v-if="(detailItem?.stops || []).length"
                  class="stops"
                >
                  <div
                    v-for="(s,i) in detailItem?.stops"
                    :key="i"
                    class="stop"
                  >
                    <span class="text-xs">#{{ i + 1 }}:</span>
                    <span>
                      {{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}
                    </span>
                    <button
                      v-if="s.mapLink"
                      type="button"
                      class="ml-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100
                             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      @click="openTicket(s.mapLink)"
                    >
                      Map
                    </button>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </div>

            <div v-if="detailItem?.ticketUrl">
              <div class="lbl">Ticket</div>
              <button
                type="button"
                class="mt-1 inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                @click="openTicket(detailItem.ticketUrl)"
              >
                Open ticket
              </button>
            </div>

            <div v-if="detailItem?.purpose" class="sm:col-span-2">
              <div class="lbl">Purpose</div>
              <div class="purpose-detail">
                {{ detailItem?.purpose }}
              </div>
            </div>

            <div v-if="detailItem?.notes" class="sm:col-span-2">
              <div class="lbl">Notes</div>
              <div class="notes-block">
                {{ detailItem?.notes }}
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="detailOpen = false"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Edit schedule modal -->
    <transition name="fade">
      <div
        v-if="editOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4"
      >
        <div
          class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-semibold">
              <span>🕒 Edit schedule</span>
            </div>
            <button
              type="button"
              class="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="editOpen = false"
            >
              ✕
            </button>
          </div>

          <div
            v-if="editError"
            class="mt-3 rounded-md border border-rose-500 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ editError }}
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="col-span-2">
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                Trip date
              </label>
              <input
                v-model="editForm.tripDate"
                type="date"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                Start hour
              </label>
              <select
                v-model="editForm.timeStartHour"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                Start minute
              </label>
              <select
                v-model="editForm.timeStartMinute"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                End hour
              </label>
              <select
                v-model="editForm.timeEndHour"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                End minute
              </label>
              <select
                v-model="editForm.timeEndMinute"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>

            <div class="col-span-2">
              <label class="mb-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                Category
              </label>
              <select
                v-model="editForm.category"
                class="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="Car">Car</option>
                <option value="Messenger">Messenger</option>
              </select>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2 text-[11px]">
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="editOpen = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-lg border border-sky-500 bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-60
                     dark:border-sky-500 dark:bg-sky-600 dark:hover:bg-sky-500"
              :disabled="editLoading"
              @click="saveEdit"
            >
              <span
                v-if="editLoading"
                class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-white/70 border-t-transparent"
              />
              Save
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Assign dialog -->
    <transition name="fade">
      <div
        v-if="assignOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4"
      >
        <div
          class="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-col gap-1">
              <div class="text-sm font-semibold">
                Assign to Driver or Messenger
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                Choose who will handle this booking.
              </div>
            </div>
            <button
              type="button"
              class="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="assignOpen = false"
            >
              ✕
            </button>
          </div>

          <!-- Role toggle -->
          <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              class="inline-flex items-center rounded-full border px-3 py-1.5 font-semibold
                     transition
                     disabled:opacity-50 disabled:cursor-not-allowed"
              :class="assignRole === 'DRIVER'
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'"
              :disabled="assignLockedRole === 'MESSENGER'"
              @click="assignRole = 'DRIVER'"
            >
              🚗 <span class="ml-2">Car driver</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-full border px-3 py-1.5 font-semibold
                     transition
                     disabled:opacity-50 disabled:cursor-not-allowed"
              :class="assignRole === 'MESSENGER'
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'"
              :disabled="assignLockedRole === 'DRIVER'"
              @click="assignRole = 'MESSENGER'"
            >
              🏍 <span class="ml-2">Messenger</span>
            </button>
          </div>

          <!-- Error -->
          <div
            v-if="assignError"
            class="mt-3 rounded-md border border-rose-500 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ assignError }}
          </div>

          <!-- People list -->
          <div class="mt-3">
            <div
              v-if="!people.length"
              class="rounded-xl border border-dashed border-slate-400 bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
            >
              Loading people…
            </div>

            <div
              v-else
              class="grid gap-2 text-xs sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            >
              <button
                v-for="p in people"
                :key="p._id"
                type="button"
                class="person-card flex w-full flex-col rounded-xl border bg-white px-3 py-3 text-left
                       transition dark:border-slate-600 dark:bg-slate-900"
                :class="{
                  selected: selectedLoginId === p.loginId,
                  busy: isBusy(p.loginId),
                }"
                :disabled="isBusy(p.loginId)"
                @click="!isBusy(p.loginId) && (selectedLoginId = p.loginId)"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700
                           dark:bg-slate-800 dark:text-slate-100"
                  >
                    {{ p.name?.substring(0, 2) || 'ID' }}
                  </div>
                  <div class="flex-1">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ p.name }}
                    </div>
                    <div class="mono text-[11px] text-slate-500 dark:text-slate-400">
                      ID: {{ p.loginId }}
                    </div>
                    <div
                      v-if="isBusy(p.loginId)"
                      class="mt-1 text-[11px] text-red-500"
                    >
                      Busy in this window
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2 text-[11px]">
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              @click="assignOpen = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-60
                     dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              :disabled="!selectedLoginId || assignLoading"
              @click="submitAssign"
            >
              <span
                v-if="assignLoading"
                class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-white/70 border-t-transparent"
              />
              Assign
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.admin-car-page {
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

/* booking cards */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.booking-card {
  position: relative;
  border-radius: 16px;
  padding: 10px 13px 12px;
  margin-bottom: 4px;
  border: 1px solid rgba(148,163,184,.35);
  background:
    radial-gradient(circle at 0 0, rgba(59,130,246,.12), transparent 60%),
    radial-gradient(circle at 100% 100%, rgba(129,140,248,.12), transparent 55%),
    rgba(255,255,255,.96);
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 24px rgba(15,23,42,0.10);
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

/* left color strip */
.booking-card::before{
  content:'';
  position:absolute;
  left:0;
  top:9px;
  bottom:9px;
  width:3px;
  border-radius:999px;
  background: linear-gradient(180deg,#0f719e,#22c55e);
  opacity:.9;
}

/* subtle glow badge */
.booking-card::after{
  content:'';
  position:absolute;
  right:-30px;
  top:-30px;
  width:80px;
  height:80px;
  background: radial-gradient(circle, rgba(59,130,246,.25), transparent 55%);
  opacity:.7;
  pointer-events:none;
}

.bc-top {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  position: relative;
  z-index: 1;
}

.bc-time {
  font-weight: 700;
  font-size: .9rem;
  color:#0f172a;
}
.bc-date {
  margin-bottom: 2px;
  font-size:.78rem;
  color:#64748b;
}

.bc-middle {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  margin-top: 4px;
  position: relative;
  z-index: 1;
}

.bc-requester {
  flex:1;
}
.bc-req-name {
  font-weight: 600;
  font-size: .9rem;
}
.bc-req-meta {
  font-size: .78rem;
}

.bc-assignee {
  display:flex;
  align-items:flex-start;
  justify-content:flex-end;
}

.bc-body {
  font-size: .8rem;
  margin-top: 4px;
  position: relative;
  z-index: 1;
}
.bc-itinerary {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:4px;
  font-size:.8rem;
}

.purpose-text-mobile {
  font-size:.82rem;
  font-weight:500;
  color:#1f2937;
}

.bc-bottom {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-top: 6px;
  position: relative;
  z-index: 1;
}

.bc-actions {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:4px;
}

.assignee-chip { font-weight: 600; }

/* table footer shared */
.table-footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.tf-left { min-width: 120px; }
.tf-middle { display:flex; align-items:center; }
.tf-right { display:flex; align-items:center; }

.lbl { font-size:.78rem; color:#64748b; }
.val { font-weight:600; }
.purpose-detail { font-weight:500; font-size:1.05rem; }
.stops { display:flex; flex-direction:column; gap:6px; }
.stop { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }

.notes-block {
  border: 1px dashed #cbd5e1;
  background:#f8fafc;
  padding: 10px 12px;
  border-radius: 10px;
  white-space: pre-wrap;
}

/* person cards */
.person-card {
  cursor: pointer;
  transition: transform .06s ease, box-shadow .06s ease, border-color .06s ease, background-color .06s ease;
}
.person-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.06);
}
.person-card.selected {
  border-color:#1f2a44;
  box-shadow: 0 0 0 2px rgba(31,42,68,0.15) inset;
}
.person-card.busy {
  opacity:.55;
  border-color:#ef4444;
  cursor:not-allowed;
}

/* fade transition (modals) */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* small screens tweaks */
@media (max-width: 600px){
  .admin-car-page {
    padding: 0 !important;
  }
  .table-footer {
    padding: 10px 12px;
    gap:10px;
  }
  .tf-left, .tf-middle, .tf-right {
    width: 100%;
  }
  .tf-right {
    justify-content: flex-end;
  }
}
</style>
