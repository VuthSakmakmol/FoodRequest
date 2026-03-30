<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useToast } from '@/composables/useToast'
import { CAR_BOOKING_PURPOSES } from '@/constants/carBookingOptions'

import CarBookingFilters from './components/CarBookingFilters.vue'
import CarBookingDesktopTable from './components/CarBookingDesktopTable.vue'
import CarBookingMobileList from './components/CarBookingMobileList.vue'
import CarBookingPagination from './components/CarBookingPagination.vue'
import CarBookingEditModal from './components/CarBookingEditModal.vue'
import CarBookingAssignModal from './components/CarBookingAssignModal.vue'
import CarBookingDetailModal from './components/CarBookingDetailModal.vue'
import CarBookingConfirmModal from './components/CarBookingConfirmModal.vue'

defineOptions({ name: 'AdminCarBooking' })

const route = useRoute()
const { showToast } = useToast()

/* responsive */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* base state */
const loading = ref(false)
const error = ref('')
const rows = ref([])

const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch = ref('')
const updating = ref({})

const exportFrom = ref(selectedDate.value)
const exportTo = ref(selectedDate.value)

watch(selectedDate, (d) => {
  exportFrom.value = d
  exportTo.value = d
})

const focusId = computed(() => String(route.query.focus || ''))

/* workflow */
const ALLOWED_NEXT = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['ON_ROAD', 'DELAYED', 'CANCELLED'],
  ON_ROAD: ['ARRIVING', 'DELAYED', 'COMEBACK', 'CANCELLED'],
  ARRIVING: ['COMEBACK', 'DELAYED', 'CANCELLED'],
  COMEBACK: ['COMPLETED', 'DELAYED', 'CANCELLED'],
  COMPLETED: [],
  DELAYED: ['ON_ROAD', 'ARRIVING', 'COMEBACK', 'CANCELLED'],
  CANCELLED: [],
}
const nextStatuses = (from) => ALLOWED_NEXT[String(from || '').toUpperCase()] || []

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']
const PER_PAGE_OPTIONS = [10, 20, 50]

/* helpers */
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '')
const absUrl = (u) =>
  !u ? '' : /^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`

function openTicket(u) {
  const url = absUrl(u)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map((s) => (s.destination === 'Other' ? s.destinationOther || 'Other' : s.destination))
    .join(' → ')
}

function assigneeName(it) {
  if (!it?.assignment) return ''
  if (it?.category === 'Messenger') {
    return it.assignment.messengerName || it.assignment.messengerId || ''
  }
  return it.assignment.driverName || it.assignment.driverId || ''
}

function hasAssignee(it) {
  if (!it?.assignment) return false
  if (it.category === 'Messenger') return !!it.assignment.messengerId
  return !!it.assignment.driverId
}

function assignedRoleOf(it) {
  return String(it?.category || '') === 'Messenger' ? 'MESSENGER' : 'DRIVER'
}
function assignedLoginIdOf(it) {
  if (!it?.assignment) return ''
  return assignedRoleOf(it) === 'MESSENGER'
    ? (it.assignment.messengerId || '')
    : (it.assignment.driverId || '')
}
function assignedNameOf(it) {
  if (!it?.assignment) return ''
  return assignedRoleOf(it) === 'MESSENGER'
    ? (it.assignment.messengerName || it.assignment.messengerId || '')
    : (it.assignment.driverName || it.assignment.driverId || '')
}

function canChangeStatus(item, nextStatus) {
  const s = String(nextStatus || '').toUpperCase()
  if (s === 'CANCELLED') return true
  return hasAssignee(item)
}

function canForceComplete(item) {
  const st = String(item?.status || '').toUpperCase()
  if (!item?._id) return false
  if (st === 'CANCELLED' || st === 'COMPLETED') return false
  return hasAssignee(item)
}

const STATUS_BADGE_CLASS = {
  PENDING: 'bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-slate-900',
  ACCEPTED: 'bg-sky-500 text-white',
  ON_ROAD: 'bg-cyan-500 text-white',
  ARRIVING: 'bg-emerald-500 text-white',
  COMPLETED: 'bg-green-600 text-white',
  COMEBACK: 'bg-indigo-500 text-white',
  DELAYED: 'bg-amber-400 text-slate-900',
  CANCELLED: 'bg-red-500 text-white',
}
function statusBadgeClass(s) {
  return (
    STATUS_BADGE_CLASS[String(s || '').toUpperCase()] ||
    'bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-slate-900'
  )
}

const ACK_BADGE_CLASS = {
  PENDING: 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-50',
  ACCEPTED: 'bg-emerald-500 text-white',
  DECLINED: 'bg-red-500 text-white',
}
function ackBadgeClass(s) {
  return (
    ACK_BADGE_CLASS[String(s || '').toUpperCase()] ||
    'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-50'
  )
}

function responseLabel(item) {
  if (!item || !item.assignment) return 'PENDING'
  if (item.category === 'Messenger') return item.assignment.messengerAck || 'PENDING'
  return item.assignment.driverAck || 'PENDING'
}

function categoryBadgeClass(cat) {
  return cat === 'Messenger' ? 'bg-orange-500 text-white' : 'bg-indigo-500 text-white'
}
function paxDisplay(p) {
  return p ?? 1
}

const STATUS_ACTION_BTN_CLASS = {
  PENDING: 'border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100',
  ACCEPTED: 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100',
  ON_ROAD: 'border-cyan-500 bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
  ARRIVING: 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  COMEBACK: 'border-indigo-500 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  COMPLETED: 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100',
  DELAYED: 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100',
  CANCELLED: 'border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100',
}
function statusButtonClass(s) {
  const base =
    'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors'
  const variant =
    STATUS_ACTION_BTN_CLASS[String(s || '').toUpperCase()] ||
    'border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100'
  return `${base} ${variant}`
}

/* filter + paging */
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter((r) => !selectedDate.value || r.tripDate === selectedDate.value)
    .filter((r) => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter((r) => statusFilter.value === 'ALL' || r.status === statusFilter.value)
    .filter((r) => {
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

const page = ref(1)
const itemsPerPage = ref(10)

const totalItems = computed(() => filtered.value.length)
const pageCount = computed(() => {
  const per = itemsPerPage.value || 10
  return Math.max(1, Math.ceil(totalItems.value / per) || 1)
})
const visibleRows = computed(() => {
  const per = itemsPerPage.value || 10
  const start = (page.value - 1) * per
  return filtered.value.slice(start, start + per)
})

watch([filtered, itemsPerPage], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

/* load */
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = {}
    if (selectedDate.value) params.date = selectedDate.value
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    if (categoryFilter.value !== 'ALL') params.category = categoryFilter.value

    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map((x) => ({
      ...x,
      stops: x.stops || [],
      assignment: x.assignment || {},
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
    showToast({ type: 'error', title: 'Load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

/* realtime */
function onCreated(doc) {
  if (doc?.tripDate && selectedDate.value && doc.tripDate !== selectedDate.value) return
  loadSchedule()
}
function onStatus(p) {
  const it = rows.value.find((x) => String(x._id) === String(p?.bookingId))
  if (it && p?.status) it.status = p.status
}
function onAssigned(p) {
  const it = rows.value.find((x) => String(x._id) === String(p?.bookingId))
  if (!it) return

  const action = String(p?.action || 'ASSIGN').toUpperCase()
  const role = String(p?.prevRole || '').toUpperCase()

  if (!it.assignment) it.assignment = {}

  if (action === 'UNASSIGN') {
    const unassignRole = role || (p?.messengerId === '' ? 'MESSENGER' : 'DRIVER')
    if (unassignRole === 'MESSENGER') {
      it.assignment.messengerId = ''
      it.assignment.messengerName = ''
      it.assignment.messengerAck = 'PENDING'
    } else {
      it.assignment.driverId = ''
      it.assignment.driverName = ''
      it.assignment.vehicleId = ''
      it.assignment.vehicleName = ''
      it.assignment.driverAck = 'PENDING'
    }

    if (p.status) it.status = p.status
    else if (!['COMPLETED', 'CANCELLED'].includes(String(it.status || '').toUpperCase())) it.status = 'PENDING'
    return
  }

  it.assignment = {
    ...(it.assignment || {}),
    driverId: p.driverId ?? it.assignment?.driverId,
    driverName: p.driverName ?? it.assignment?.driverName,
    messengerId: p.messengerId ?? it.assignment?.messengerId,
    messengerName: p.messengerName ?? it.assignment?.messengerName,
    driverAck: it.assignment?.driverAck || 'PENDING',
    messengerAck: it.assignment?.messengerAck || 'PENDING',
  }

  if (p.status) it.status = p.status
  else if (it.status === 'PENDING') it.status = 'ACCEPTED'
}
function onDriverAck(p) {
  const it = rows.value.find((x) => String(x._id) === String(p?.bookingId))
  if (!it) return
  const resp = String(p?.response || '').toUpperCase()
  it.assignment = { ...(it.assignment || {}), driverAck: resp, driverAckAt: p?.at }
  if (resp === 'ACCEPTED' && String(it.status).toUpperCase() === 'PENDING') it.status = 'ACCEPTED'
  if (resp === 'DECLINED' && String(it.status).toUpperCase() === 'ACCEPTED') it.status = 'PENDING'
}
function onMessengerAck(p) {
  const it = rows.value.find((x) => String(x._id) === String(p?.bookingId))
  if (!it) return
  const resp = String(p?.response || '').toUpperCase()
  it.assignment = { ...(it.assignment || {}), messengerAck: resp, messengerAckAt: p?.at }
  if (it.category === 'Messenger' && resp === 'ACCEPTED' && String(it.status).toUpperCase() === 'PENDING') {
    it.status = 'ACCEPTED'
  }
  if (it.category === 'Messenger' && resp === 'DECLINED' && String(it.status).toUpperCase() === 'ACCEPTED') {
    it.status = 'PENDING'
  }
}
function onUpdated(p) {
  const it = rows.value.find((x) => String(x._id) === String(p?.bookingId))
  if (!it) return
  Object.assign(it, p?.patch || {})
}
function onDeleted(p) {
  const id = String(p?.bookingId || '')
  if (!id) return
  rows.value = rows.value.filter((x) => String(x._id) !== id)
}

/* detail */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item) {
  closeAllModals()
  detailItem.value = item
  detailOpen.value = true
}

/* assign */
const assignOpen = ref(false)
const assignTarget = ref(null)
const assignLoading = ref(false)
const assignError = ref('')
const assignRole = ref('DRIVER')
const assignLockedRole = ref('DRIVER')
const people = ref([])
const selectedLoginId = ref('')
const busyMap = ref(new Map())

function isBusy(loginId) {
  const v = busyMap.value.get(String(loginId))
  if (!v) return false
  const st = String(v.status || '').toUpperCase()
  return v.busy && !['COMPLETED', 'CANCELLED'].includes(st)
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

  const currentLoginId =
    assignRole.value === 'MESSENGER' ? item?.assignment?.messengerId : item?.assignment?.driverId
  selectedLoginId.value = currentLoginId || ''
  const role = assignRole.value

  const list = await fetchFirstOk([
    () => api.get(role === 'DRIVER' ? '/admin/drivers' : '/admin/messengers'),
    () => api.get('/admin/users', { params: { role } }),
  ])

  people.value = list.map((u) => ({
    _id: String(u._id || u.id || u.loginId),
    loginId: String(u.loginId || ''),
    name: u.name || u.fullName || u.loginId || '—',
  }))

  try {
    const { data } = await api.get('/admin/availability/assignees', {
      params: { role, date: item.tripDate, start: item.timeStart, end: item.timeEnd },
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
          const consideredBusy = !['COMPLETED', 'CANCELLED'].includes(stat)
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
  closeAllModals()
  assignTarget.value = item
  assignError.value = ''

  if (item?.category === 'Messenger') {
    assignLockedRole.value = 'MESSENGER'
    assignRole.value = 'MESSENGER'
  } else {
    assignLockedRole.value = 'NONE'
    assignRole.value = 'DRIVER'
  }

  assignOpen.value = true
  loadPeopleAndAvailability(item)
}

watch(assignRole, () => {
  if (assignOpen.value && assignTarget.value?._id) loadPeopleAndAvailability(assignTarget.value)
})

async function submitAssign() {
  if (!assignTarget.value?._id) return

  if (!selectedLoginId.value) {
    assignError.value = 'Please select one person.'
    showToast({ type: 'warning', title: 'Missing selection', message: 'Please select a person to assign.' })
    return
  }

  if (isBusy(selectedLoginId.value)) {
    assignError.value = 'This person is busy in this window.'
    showToast({ type: 'warning', title: 'Unavailable', message: 'This person is busy in this time window.' })
    return
  }

  assignLoading.value = true
  assignError.value = ''

  try {
    const role = String(assignRole.value || 'DRIVER').toUpperCase()
    const payload = {
      role,
      status: 'ACCEPTED',
      ...(role === 'MESSENGER'
        ? { messengerId: selectedLoginId.value }
        : { driverId: selectedLoginId.value }),
    }

    await api.post(`/admin/car-bookings/${assignTarget.value._id}/assign`, payload)

    const it = rows.value.find((x) => String(x._id) === String(assignTarget.value._id))
    const person = people.value.find((p) => String(p.loginId) === String(selectedLoginId.value))

    if (it) {
      if (!it.assignment) it.assignment = {}
      if (role === 'MESSENGER') {
        it.assignment.messengerId = selectedLoginId.value
        it.assignment.messengerName = person?.name || ''
        it.assignment.messengerAck = 'PENDING'
      } else {
        it.assignment.driverId = selectedLoginId.value
        it.assignment.driverName = person?.name || ''
        it.assignment.driverAck = 'PENDING'
      }
      it.status = 'ACCEPTED'
    }

    assignOpen.value = false
    showToast({ type: 'success', title: 'Assigned', message: 'Booking assigned and accepted by admin.' })
  } catch (e) {
    assignError.value = e?.response?.data?.message || e?.message || 'Failed to assign'
    showToast({ type: 'error', title: 'Assign failed', message: assignError.value })
  } finally {
    assignLoading.value = false
  }
}

/* cancel */
const cancelConfirmOpen = ref(false)
const cancelTarget = ref(null)

function requestCancel(item) {
  closeAllModals()
  cancelTarget.value = item
  cancelConfirmOpen.value = true
}
function closeCancelConfirm() {
  cancelConfirmOpen.value = false
  cancelTarget.value = null
}
async function confirmCancel() {
  if (!cancelTarget.value?._id) return
  const it = cancelTarget.value
  closeCancelConfirm()
  await updateStatus(it, 'CANCELLED')
}

/* status */
async function updateStatus(item, nextStatus) {
  if (!item?._id || !nextStatus) return

  const allowed = nextStatuses(item.status)
  if (!allowed.includes(nextStatus)) {
    const msg = `Cannot change from ${item.status} to ${nextStatus}`
    error.value = msg
    showToast({ type: 'warning', title: 'Invalid transition', message: msg })
    return
  }

  updating.value[item._id] = true
  const prevStatus = item.status
  try {
    item.status = nextStatus
    await api.patch(`/admin/car-bookings/${item._id}/status`, { status: nextStatus })
    showToast({ type: 'success', title: 'Status updated', message: `Booking status: ${prevStatus} → ${nextStatus}` })
  } catch (e) {
    await loadSchedule()
    error.value = e?.response?.data?.message || e?.message || 'Failed to update status'
    showToast({ type: 'error', title: 'Update failed', message: error.value })
  } finally {
    updating.value[item._id] = false
  }
}

/* force complete */
const forceConfirmOpen = ref(false)
const forceTarget = ref(null)

function requestForceComplete(item) {
  closeAllModals()
  forceTarget.value = item
  forceConfirmOpen.value = true
}
function closeForceConfirm() {
  forceConfirmOpen.value = false
  forceTarget.value = null
}
async function confirmForceComplete() {
  if (!forceTarget.value?._id) return
  forceConfirmOpen.value = false
  await forceComplete(forceTarget.value)
  forceTarget.value = null
}
async function forceComplete(item) {
  if (!item?._id) return
  if (!canForceComplete(item)) {
    showToast({ type: 'warning', title: 'Not allowed', message: 'Cannot force complete this booking.' })
    return
  }

  updating.value[item._id] = true
  const prev = item.status
  try {
    item.status = 'COMPLETED'
    await api.patch(`/admin/car-bookings/${item._id}/status`, {
      status: 'COMPLETED',
      forceComplete: true,
    })
    showToast({ type: 'success', title: 'Completed', message: `Force completed: ${prev} → COMPLETED` })
  } catch (e) {
    await loadSchedule()
    const msg = e?.response?.data?.message || e?.message || 'Force complete failed'
    showToast({ type: 'error', title: 'Failed', message: msg })
  } finally {
    updating.value[item._id] = false
  }
}

/* edit */
const editOpen = ref(false)
const editTarget = ref(null)
const editForm = ref({
  tripDate: '',
  timeStartHour: '',
  timeStartMinute: '',
  timeEndHour: '',
  timeEndMinute: '',
  category: 'Car',
  purpose: '',
})
const editLoading = ref(false)
const editError = ref('')

function openEditDialog(item) {
  closeAllModals()
  editTarget.value = item
  editError.value = ''

  const [sh, sm] = (item.timeStart || '08:00').split(':')
  const [eh, em] = (item.timeEnd || '09:00').split(':')

  editForm.value = {
    tripDate: item.tripDate || selectedDate.value,
    timeStartHour: sh,
    timeStartMinute: sm,
    timeEndHour: eh,
    timeEndMinute: em,
    category: item.category || 'Car',
    purpose: item.purpose || '',
  }

  editOpen.value = true
}

async function saveEdit() {
  if (!editTarget.value?._id) return

  editError.value = ''

  const timeStart = `${editForm.value.timeStartHour}:${editForm.value.timeStartMinute}`
  const timeEnd = `${editForm.value.timeEndHour}:${editForm.value.timeEndMinute}`

  if (timeEnd <= timeStart) {
    editError.value = 'End time must be after start time.'
    showToast({ type: 'warning', title: 'Invalid time', message: editError.value })
    return
  }

  const old = editTarget.value
  const payload = {
    tripDate: editForm.value.tripDate,
    timeStart,
    timeEnd,
    category: editForm.value.category,
    purpose: editForm.value.purpose,
  }

  const scheduleChanged =
    old.tripDate !== payload.tripDate ||
    old.timeStart !== payload.timeStart ||
    old.timeEnd !== payload.timeEnd ||
    old.category !== payload.category

  const needReopen = scheduleChanged && old.status !== 'PENDING'

  editLoading.value = true
  try {
    await api.patch(`/admin/car-bookings/${old._id}`, payload)

    const it = rows.value.find((x) => String(x._id) === String(old._id))
    if (it) {
      it.tripDate = payload.tripDate
      it.timeStart = payload.timeStart
      it.timeEnd = payload.timeEnd
      it.category = payload.category
      it.purpose = payload.purpose
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
    showToast({ type: 'error', title: 'Update failed', message: editError.value })
  } finally {
    editLoading.value = false
  }
}

/* export */
function buildQuery(params = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === 'ALL') return
    sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function normalizeRange(from, to) {
  const f = String(from || '').trim()
  const t = String(to || '').trim()
  if (!f && !t) return { date: selectedDate.value }
  const ff = f || t
  const tt = t || f
  if (ff && tt && ff > tt) return { dateFrom: tt, dateTo: ff }
  return { dateFrom: ff, dateTo: tt }
}

async function exportExcel() {
  try {
    const range = normalizeRange(exportFrom.value, exportTo.value)
    const params = {
      ...range,
      status: statusFilter.value,
      category: categoryFilter.value,
      q: (qSearch.value || '').trim(),
    }

    const res = await api.get(`/admin/car-bookings/export${buildQuery(params)}`, {
      responseType: 'blob',
    })

    const cd = res?.headers?.['content-disposition'] || ''
    const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(cd)
    const fileName = decodeURIComponent(match?.[1] || '') || `car-bookings_${selectedDate.value || 'all'}.xlsx`

    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    showToast({ type: 'success', title: 'Exported', message: `Downloaded ${fileName}` })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Failed to export Excel'
    showToast({ type: 'error', title: 'Export failed', message: msg })
  }
}

/* unassign */
const unassignConfirmOpen = ref(false)
const unassignLoading = ref(false)
const unassignError = ref('')
const unassignTarget = ref(null)
const unassignRole = ref('DRIVER')

function requestUnassignFor(item) {
  if (!item?._id) return
  unassignError.value = ''
  unassignTarget.value = item
  unassignRole.value = assignedRoleOf(item)
  unassignConfirmOpen.value = true
}
function closeUnassignConfirm() {
  unassignConfirmOpen.value = false
  unassignTarget.value = null
}
async function confirmUnassign() {
  if (!unassignTarget.value?._id) return

  const role = String(unassignRole.value || 'DRIVER').toUpperCase()

  unassignLoading.value = true
  unassignError.value = ''
  try {
    const payload = role === 'MESSENGER' ? { role, messengerId: '' } : { role, driverId: '' }
    await api.post(`/admin/car-bookings/${unassignTarget.value._id}/assign`, payload)

    const it = rows.value.find((x) => String(x._id) === String(unassignTarget.value._id))
    if (it) {
      if (!it.assignment) it.assignment = {}
      if (role === 'MESSENGER') {
        it.assignment.messengerId = ''
        it.assignment.messengerName = ''
        it.assignment.messengerAck = 'PENDING'
      } else {
        it.assignment.driverId = ''
        it.assignment.driverName = ''
        it.assignment.vehicleId = ''
        it.assignment.vehicleName = ''
        it.assignment.driverAck = 'PENDING'
      }
      if (!['COMPLETED', 'CANCELLED'].includes(String(it.status || '').toUpperCase())) {
        it.status = 'PENDING'
      }
    }

    unassignConfirmOpen.value = false
    unassignTarget.value = null
    showToast({
      type: 'success',
      title: 'Unassigned',
      message: `Removed ${role === 'MESSENGER' ? 'messenger' : 'driver'} from this booking.`,
    })
  } catch (e) {
    unassignError.value = e?.response?.data?.message || e?.message || 'Failed to unassign'
    showToast({ type: 'error', title: 'Unassign failed', message: unassignError.value })
  } finally {
    unassignLoading.value = false
  }
}

/* modal common */
function closeAllModals() {
  unassignConfirmOpen.value = false
  cancelConfirmOpen.value = false
  forceConfirmOpen.value = false
  assignOpen.value = false
  editOpen.value = false
  detailOpen.value = false
}

const isAnyModalOpen = computed(() => {
  return (
    !!cancelConfirmOpen.value ||
    !!unassignConfirmOpen.value ||
    !!forceConfirmOpen.value ||
    !!detailOpen.value ||
    !!editOpen.value ||
    !!assignOpen.value
  )
})

function lockBodyScroll(locked) {
  if (typeof document === 'undefined') return
  if (locked) {
    document.body.dataset._scrollY = String(window.scrollY || 0)
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
  } else {
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
    const y = Number(document.body.dataset._scrollY || 0)
    delete document.body.dataset._scrollY
    if (!Number.isNaN(y)) window.scrollTo({ top: y, behavior: 'auto' })
  }
}

function closeTopModal() {
  if (unassignConfirmOpen.value) return closeUnassignConfirm()
  if (cancelConfirmOpen.value) return closeCancelConfirm()
  if (forceConfirmOpen.value) return closeForceConfirm()
  if (assignOpen.value) return (assignOpen.value = false)
  if (editOpen.value) return (editOpen.value = false)
  if (detailOpen.value) return (detailOpen.value = false)
}

function onKeyDown(e) {
  if (e.key === 'Escape') closeTopModal()
}

/* lifecycle */
watch(isAnyModalOpen, (open) => lockBodyScroll(open), { immediate: true })

onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown)

  try {
    subscribeRoleIfNeeded({ role: 'ADMIN' })
  } catch {}

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

  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
  lockBodyScroll(false)
})

watch([selectedDate, statusFilter, categoryFilter], () => {
  page.value = 1
  loadSchedule()
})

watch(
  () => route.query.date,
  (val) => {
    if (!val) return
    const dStr = dayjs(val).isValid() ? dayjs(val).format('YYYY-MM-DD') : String(val)
    selectedDate.value = dStr
  },
)
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100 admin-car-page">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div
        class="rounded-t-2xl border-b border-slate-200 bg-gradient-to-r
               from-[#0f719e] via-[#b3b4df] to-[#ae9aea]
               px-3 py-2 text-slate-900
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 dark:text-slate-100"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-col leading-tight">
            <span class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-800/80 dark:text-slate-200/80">
              Car Booking
            </span>
            <span class="text-sm font-semibold">Admin car &amp; messenger schedule</span>
          </div>
          <div class="flex flex-col items-end text-[11px] text-slate-900/80 dark:text-slate-100/80">
            <span>Date: {{ selectedDate || '—' }}</span>
            <span>Total bookings: {{ totalItems }}</span>
          </div>
        </div>
      </div>

      <CarBookingFilters
        v-model:selectedDate="selectedDate"
        v-model:statusFilter="statusFilter"
        v-model:categoryFilter="categoryFilter"
        v-model:qSearch="qSearch"
        v-model:itemsPerPage="itemsPerPage"
        v-model:exportFrom="exportFrom"
        v-model:exportTo="exportTo"
        :loading="loading"
        :per-page-options="PER_PAGE_OPTIONS"
        @refresh="loadSchedule"
        @export="exportExcel"
      />

      <div
        v-if="error"
        class="mx-3 mt-2 rounded-md border border-rose-500 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
               dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ error }}
      </div>

      <div class="px-1.5 py-2 sm:px-3 sm:py-3">
        <CarBookingMobileList
          v-if="isMobile"
          :loading="loading"
          :rows="visibleRows"
          :selected-date="selectedDate"
          :focus-id="focusId"
          :updating="updating"
          :next-statuses="nextStatuses"
          :can-change-status="canChangeStatus"
          :can-force-complete="canForceComplete"
          :status-badge-class="statusBadgeClass"
          :ack-badge-class="ackBadgeClass"
          :status-button-class="statusButtonClass"
          :pretty-stops="prettyStops"
          :assignee-name="assigneeName"
          :response-label="responseLabel"
          :pax-display="paxDisplay"
          @open-ticket="openTicket"
          @edit="openEditDialog"
          @assign="openAssignDialog"
          @details="showDetails"
          @cancel="requestCancel"
          @status="updateStatus"
          @force-complete="requestForceComplete"
        />

        <CarBookingDesktopTable
          v-else
          :loading="loading"
          :rows="visibleRows"
          :selected-date="selectedDate"
          :focus-id="focusId"
          :updating="updating"
          :next-statuses="nextStatuses"
          :can-change-status="canChangeStatus"
          :can-force-complete="canForceComplete"
          :status-badge-class="statusBadgeClass"
          :ack-badge-class="ackBadgeClass"
          :status-button-class="statusButtonClass"
          :category-badge-class="categoryBadgeClass"
          :pretty-stops="prettyStops"
          :assignee-name="assigneeName"
          :response-label="responseLabel"
          :pax-display="paxDisplay"
          @open-ticket="openTicket"
          @edit="openEditDialog"
          @assign="openAssignDialog"
          @details="showDetails"
          @cancel="requestCancel"
          @status="updateStatus"
          @force-complete="requestForceComplete"
        />

        <CarBookingPagination
          :page="page"
          :page-count="pageCount"
          @prev="page > 1 && (page = page - 1)"
          @next="page < pageCount && (page = page + 1)"
        />
      </div>
    </div>

    <CarBookingEditModal
      v-model:open="editOpen"
      v-model:form="editForm"
      :hours="HOURS"
      :minutes="MINUTES"
      :purposes="CAR_BOOKING_PURPOSES"
      :loading="editLoading"
      :error="editError"
      @save="saveEdit"
    />

    <CarBookingAssignModal
      v-model:open="assignOpen"
      v-model:assignRole="assignRole"
      v-model:selectedLoginId="selectedLoginId"
      :locked-role="assignLockedRole"
      :people="people"
      :busy-map="busyMap"
      :loading="assignLoading"
      :error="assignError"
      @save="submitAssign"
    />

    <CarBookingDetailModal
      v-model:open="detailOpen"
      :item="detailItem"
      :pretty-stops="prettyStops"
      :assignee-name="assigneeName"
      :response-label="responseLabel"
      :status-badge-class="statusBadgeClass"
      :ack-badge-class="ackBadgeClass"
      @open-ticket="openTicket"
      @unassign="requestUnassignFor"
    />

    <CarBookingConfirmModal
      v-model:open="cancelConfirmOpen"
      title="Cancel booking"
      message="Are you sure you want to cancel this booking?"
      confirm-text="Yes, cancel"
      confirm-class="border-red-500 bg-red-600 text-white hover:bg-red-500"
      @confirm="confirmCancel"
    />

    <CarBookingConfirmModal
      v-model:open="forceConfirmOpen"
      title="Force complete booking"
      message="Are you sure you want to mark this booking as COMPLETED?"
      confirm-text="Yes, complete"
      confirm-class="border-green-500 bg-green-600 text-white hover:bg-green-500"
      @confirm="confirmForceComplete"
    />

    <CarBookingConfirmModal
      v-model:open="unassignConfirmOpen"
      title="Unassign booking"
      message="Are you sure you want to remove the assigned person from this booking?"
      confirm-text="Yes, unassign"
      confirm-class="border-amber-500 bg-amber-500 text-slate-900 hover:bg-amber-400"
      :loading="unassignLoading"
      :error="unassignError"
      @confirm="confirmUnassign"
    />
  </div>
</template>