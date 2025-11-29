<!-- src/views/admin/carbooking/AdminCarBooking.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useDisplay } from 'vuetify'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'

/* ───────── responsive helpers (for footer) ───────── */
const { smAndDown } = useDisplay()
const isMobile = computed(() => smAndDown.value)

/* base state */
const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const route = useRoute()

const selectedDate   = ref(dayjs().format('YYYY-MM-DD'))
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

/* Time helpers for edit dialog */
const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

/* Helpers */
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '').replace(/\/$/, '')
const absUrl = (u) => !u ? '' : (/^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u.startsWith('/')?'':'/'}${u}`)
const openTicket = (u) => { const url = absUrl(u); if (url) window.open(url, '_blank', 'noopener,noreferrer') }

/* Table headers */
const headers = [
  { title: 'Time',        key: 'time',       sortable: true,  width: 240 },
  { title: 'Category',    key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',   key: 'requester',  sortable: true,  width: 360 },
  { title: 'Destination', key: 'destination',sortable: false, width: 350 },
  { title: 'Pax',         key: 'passengers', sortable: true,  width: 70,  align: 'center' },
  { title: 'Purpose',     key: 'purpose',    sortable: false, width: 260 },
  { title: 'Assigned',    key: 'assigned',   sortable: false, width: 160 },
  { title: 'Driver Resp.',key: 'driverAck',  sortable: false, width: 150, align: 'end' },
  { title: 'Status',      key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: '',            key: 'actions',    sortable: false, width: 180, align: 'end' }
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
      assignment: x.assignment || {}
    }))
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
  } finally { loading.value = false }
}

function prettyStops(stops = []) {
  if (!stops.length) return '—'
  return stops
    .map(s => s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination)
    .join(' → ')
}

function rowClass(item){
  if (!item?.tripDate) return ''
  return item.tripDate === selectedDate.value ? 'highlight-row' : ''
}

/* Colors + Icons */
const statusColor = s => ({
  PENDING:'grey', ACCEPTED:'primary', ON_ROAD:'info', ARRIVING:'teal',
  COMPLETED:'success', DELAYED:'warning', CANCELLED:'error'
}[s] || 'grey')

const statusIcon = s => ({
  PENDING:'mdi-timer-sand',
  ACCEPTED:'mdi-check-circle-outline',
  ON_ROAD:'mdi-truck-fast',
  ARRIVING:'mdi-flag-checkered',
  COMPLETED:'mdi-check-all',
  DELAYED:'mdi-alert',
  CANCELLED:'mdi-cancel'
}[s] || 'mdi-timer-sand')

const ackColor = s => ({ PENDING:'grey', ACCEPTED:'success', DECLINED:'error' }[s] || 'grey')
const ackIcon  = s => ({
  PENDING:'mdi-help-circle-outline',
  ACCEPTED:'mdi-thumb-up-outline',
  DECLINED:'mdi-thumb-down-outline'
}[s] || 'mdi-help-circle-outline')

/* Assigned chip helpers */
const assigneeName = (it) => {
  if (!it?.assignment) return ''
  if (it?.category === 'Messenger') {
    return it.assignment.messengerName || it.assignment.messengerId || ''
  }
  return it.assignment.driverName || it.assignment.driverId || ''
}
const assigneeColor = (it) => (it?.category === 'Messenger' ? 'deep-orange' : 'indigo')
const assigneeIcon = (it) => (it?.category === 'Messenger' ? 'mdi-motorbike' : 'mdi-car')

/* Same logic as backend: has assignee or not */
const hasAssignee = (it) => {
  if (!it?.assignment) return false
  if (it.category === 'Messenger') return !!it.assignment.messengerId
  return !!it.assignment.driverId
}

/* Search/filter */
const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name,
        r.employee?.department,
        r.employeeId,
        r.purpose,
        prettyStops(r.stops),
        assigneeName(r),
        r.assignment?.driverAck
      ].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

/* ───────── Pagination ───────── */
const page = ref(1)
const itemsPerPage = ref(10)
const pageCount = computed(() => {
  const n = Math.ceil((filtered.value?.length || 0) / (itemsPerPage.value || 10))
  return Math.max(1, n || 1)
})
const totalItems = computed(() => filtered.value?.length || 0)
const rangeStart = computed(() => totalItems.value ? (page.value - 1) * itemsPerPage.value + 1 : 0)
const rangeEnd   = computed(() => Math.min(page.value * itemsPerPage.value, totalItems.value))

/* For mobile cards: use same page & itemsPerPage */
const visibleRows = computed(() => {
  const per = itemsPerPage.value || 10
  const start = (page.value - 1) * per
  return filtered.value.slice(start, start + per)
})

watch([filtered, itemsPerPage], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

/* ───────── Realtime ───────── */
// new booking created
function onCreated(doc) {
  if (doc?.tripDate && selectedDate.value && doc.tripDate !== selectedDate.value) return
  loadSchedule()
}

// status change
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

// assign/change driver or messenger
function onAssigned(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return
  it.assignment = {
    ...(it.assignment || {}),
    driverId: p.driverId ?? it.assignment?.driverId ?? '',
    driverName: p.driverName ?? it.assignment?.driverName ?? '',
    messengerId: p.messengerId ?? it.assignment?.messengerId ?? '',
    messengerName: p.messengerName ?? it.assignment?.messengerName ?? '',
    vehicleId: p.vehicleId ?? it.assignment?.vehicleId ?? '',
    vehicleName: p.vehicleName ?? it.assignment?.vehicleName ?? '',
    driverAck: 'PENDING',
    messengerAck: it.assignment?.messengerAck || 'PENDING'
  }
  if (p.status) it.status = p.status
  if (p.category) it.category = p.category
}

// driver acknowledges
function onDriverAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.assignment = { ...(it.assignment || {}), driverAck: p.response, driverAckAt: p.at }
}

// messenger acknowledges
function onMessengerAck(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.assignment = { ...(it.assignment || {}), messengerAck: p.response, messengerAckAt: p.at }
}

// booking fields updated
function onUpdated(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (!it) return
  const patch = p?.patch || {}
  Object.assign(it, patch)
}

// booking deleted
function onDeleted(p) {
  const id = String(p?.bookingId || '')
  if (!id) return
  rows.value = rows.value.filter(x => String(x._id) !== id)
}

/* lifecycle: subscribe + initial load */
onMounted(() => {
  try { subscribeRoleIfNeeded({ role: 'ADMIN' }) } catch {}
  if (route.query.date) selectedDate.value = route.query.date
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
})

watch([selectedDate, statusFilter, categoryFilter], loadSchedule)

/* Details dialog */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }

/* ───────── Assign flow (swap driver/messenger) ───────── */
const assignOpen = ref(false)
const assignTarget = ref(null)
const assignLoading = ref(false)
const assignError = ref('')

const assignRole = ref('DRIVER')
const assignLockedRole = ref('DRIVER')
const people = ref([])
const selectedLoginId = ref('')

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
  assignError.value = ''

  const locked = item?.category === 'Messenger' ? 'MESSENGER' : 'DRIVER'
  assignLockedRole.value = locked
  assignRole.value = locked

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
    return
  }
  if (isBusy(selectedLoginId.value)) {
    assignError.value = 'This person is busy in this window.'
    return
  }

  assignLoading.value = true
  assignError.value = ''
  try {
    await api.post(`/admin/car-bookings/${assignTarget.value._id}/assign`, {
      driverId: selectedLoginId.value,
      role: assignRole.value,
      status: 'PENDING'
    })

    const it = rows.value.find(x => String(x._id) === String(assignTarget.value._id))
    if (it) {
      if (assignRole.value === 'MESSENGER') {
        it.assignment = {
          ...(it.assignment || {}),
          messengerId: selectedLoginId.value,
          driverAck: 'PENDING'
        }
      } else {
        it.assignment = {
          ...(it.assignment || {}),
          driverId: selectedLoginId.value,
          driverAck: 'PENDING'
        }
      }
      it.status = 'PENDING'
    }

    assignOpen.value = false
  } catch (e) {
    assignError.value = e?.response?.data?.message || e?.message || 'Failed to assign'
  } finally {
    assignLoading.value = false
  }
}

/* ───────── Status update ───────── */
async function updateStatus(item, nextStatus){
  if (!item?._id || !nextStatus) return
  const allowed = nextStatuses(item.status)
  if (!allowed.includes(nextStatus)) {
    error.value = `Cannot change from ${item.status} to ${nextStatus}`
    return
  }
  updating.value[item._id] = true
  try {
    item.status = nextStatus
    await api.patch(`/admin/car-bookings/${item._id}/status`, { status: nextStatus })
  } catch (e) {
    await loadSchedule()
    error.value = e?.response?.data?.message || e?.message || 'Failed to update status'
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
  category: 'Car'
})
const editLoading = ref(false)
const editError   = ref('')

function openEditDialog(item) {
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
    category: item.category || 'Car'
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
    return
  }

  const old = editTarget.value

  const payload = {
    tripDate: editForm.value.tripDate,
    timeStart,
    timeEnd,
    category: editForm.value.category
  }

  const scheduleChanged =
    old.tripDate  !== payload.tripDate ||
    old.timeStart !== payload.timeStart ||
    old.timeEnd   !== payload.timeEnd ||
    old.category  !== payload.category

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

    if (scheduleChanged) {
      await api.patch(`/admin/car-bookings/${old._id}/status`, {
        status: 'PENDING',
        forceReopen: true
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
  } catch (e) {
    editError.value = e?.response?.data?.message || e?.message || 'Failed to update schedule'
  } finally {
    editLoading.value = false
  }
}
</script>

<template>
  <v-container fluid class="pa-2 admin-car-page">
    <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
      <!-- Gradient header = filters -->
      <div class="hero hero-filters">
        <div class="hero-inner">
          <v-row dense>
            <v-col cols="12" md="3">
              <v-text-field
                v-model="selectedDate"
                type="date"
                label="Date"
                variant="outlined"
                density="compact"
                hide-details
                clearable
              />
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                :items="['ALL','PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED']"
                v-model="statusFilter"
                label="Status"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                :items="['ALL','Car','Messenger']"
                v-model="categoryFilter"
                label="Category"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model="qSearch"
                label="Search requester / purpose / destination / assignee / driverResp"
                variant="outlined"
                density="compact"
                hide-details
                clearable
              >
                <template #prepend-inner>
                  <v-icon icon="mdi-magnify" size="18" />
                </template>
              </v-text-field>
            </v-col>
          </v-row>
        </div>
      </div>

      <div class="px-3 pb-3 pt-3">
        <v-card flat class="soft-card">
          <v-card-text class="pt-2 pb-1 px-2">
            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              border="start"
              class="mb-3"
            >
              {{ error }}
            </v-alert>

            <!-- DESKTOP/TABLET: TABLE VIEW -->
            <div v-if="!isMobile" class="table-scroll">
              <v-data-table
                :headers="headers"
                :items="filtered"
                :loading="loading"
                item-key="_id"
                density="compact"
                class="elevated"
                v-model:page="page"
                :items-per-page="itemsPerPage"
                :row-class="rowClass"
              >
                <template #loading>
                  <v-skeleton-loader type="table-row@6" />
                </template>

                <template #item.time="{ item }">
                  <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
                </template>

                <template #item.category="{ item }">
                  <v-chip :color="item.category === 'Car' ? 'indigo' : 'deep-orange'" size="small" label>
                    <v-icon
                      :icon="item.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'"
                      size="16"
                    />
                    <span class="ml-2">{{ item.category }}</span>
                  </v-chip>
                </template>

                <template #item.requester="{ item }">
                  <div class="d-flex align-center">
                    <div>
                      <div class="font-weight-600">{{ item.employee?.name || '—' }}</div>
                      <div class="text-caption text-medium-emphasis">
                        {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Destination column -->
                <template #item.destination="{ item }">
                  <div class="truncate-2">
                    {{ prettyStops(item.stops) }}
                    <v-btn
                      v-if="item.ticketUrl"
                      size="x-small"
                      color="indigo"
                      variant="tonal"
                      class="ml-2"
                      @click.stop="openTicket(item.ticketUrl)"
                    >
                      <v-icon icon="mdi-paperclip" size="16" class="mr-1" />
                      Ticket
                    </v-btn>
                  </div>
                </template>

                <template #item.passengers="{ item }">
                  <div class="text-center">{{ item.passengers ?? 1 }}</div>
                </template>

                <template #item.purpose="{ item }">
                  <div class="purpose-pill">
                    <v-icon icon="mdi-lightbulb-on-outline" size="16" class="mr-2" />
                    <span class="purpose-text">{{ item.purpose || '—' }}</span>
                  </div>
                </template>

                <template #item.assigned="{ item }">
                  <div class="d-flex align-center" style="gap:6px;">
                    <template v-if="assigneeName(item)">
                      <v-chip :color="assigneeColor(item)" size="small" class="assignee-chip" label>
                        <v-icon :icon="assigneeIcon(item)" size="16" class="mr-2" />
                        {{ assigneeName(item) }}
                      </v-chip>
                    </template>
                    <template v-else>
                      <v-chip color="grey" size="small" variant="tonal" class="assignee-chip" label>
                        <v-icon icon="mdi-account-off-outline" size="16" class="mr-2" />
                        Unassigned
                      </v-chip>
                    </template>
                  </div>
                </template>

                <template #item.driverAck="{ item }">
                  <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="small" label>
                    <v-icon :icon="ackIcon(item.assignment?.driverAck || 'PENDING')" size="16" class="mr-1" />
                    {{ (item.assignment?.driverAck || 'PENDING') }}
                  </v-chip>
                </template>

                <template #item.status="{ item }">
                  <v-chip :color="statusColor(item.status)" size="small" label>
                    <v-icon :icon="statusIcon(item.status)" size="16" class="mr-1" />
                    {{ item.status }}
                  </v-chip>
                </template>

                <template #item.actions="{ item }">
                  <v-btn
                    size="small"
                    variant="text"
                    color="primary"
                    class="mr-1"
                    @click.stop="openEditDialog(item)"
                  >
                    <v-icon icon="mdi-calendar-clock" size="18" class="mr-2" />
                    Edit
                  </v-btn>

                  <v-menu location="bottom end">
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        size="small"
                        variant="tonal"
                        color="primary"
                        :loading="!!updating[item._id]"
                        :disabled="!hasAssignee(item)"
                      >
                        <v-icon icon="mdi-sync" size="18" class="mr-2" />
                        Update
                      </v-btn>
                    </template>
                    <v-list density="compact" min-width="260">
                      <v-list-subheader>Next status</v-list-subheader>
                      <template v-if="nextStatuses(item.status).length">
                        <v-list-item
                          v-for="s in nextStatuses(item.status)"
                          :key="s"
                          @click.stop="updateStatus(item, s)"
                        >
                          <template #prepend>
                            <v-icon :icon="statusIcon(s)" size="18" />
                          </template>
                          <v-list-item-title>{{ s }}</v-list-item-title>
                        </v-list-item>
                      </template>
                      <v-list-item v-else disabled>
                        <template #prepend>
                          <v-icon icon="mdi-lock-outline" size="18" />
                        </template>
                        <v-list-item-title>No further changes</v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>

                  <v-btn
                    size="small"
                    variant="text"
                    color="secondary"
                    class="ml-1"
                    @click.stop="openAssignDialog(item)"
                  >
                    <v-icon icon="mdi-badge-account-horizontal-outline" size="18" class="mr-2" />
                    Assign
                  </v-btn>

                  <v-btn
                    size="small"
                    variant="text"
                    color="secondary"
                    class="ml-1"
                    @click.stop="showDetails(item)"
                  >
                    <v-icon icon="mdi-information-outline" size="18" class="mr-2" />
                    Details
                  </v-btn>
                </template>

                <template #no-data>
                  <v-sheet class="pa-6 text-center" color="grey-lighten-4" rounded="lg">
                    No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
                  </v-sheet>
                </template>

                <template #bottom>
                  <div class="table-footer">
                    <div class="tf-left">
                      <div class="text-caption text-medium-emphasis d-none d-sm-inline">
                        Showing {{ rangeStart }}–{{ rangeEnd }} of {{ totalItems }}
                      </div>
                      <div class="text-caption text-medium-emphasis d-sm-none">
                        {{ page }} / {{ pageCount }}
                      </div>
                    </div>

                    <div class="tf-middle">
                      <v-select
                        v-if="!isMobile"
                        v-model="itemsPerPage"
                        :items="[5,10,20,50]"
                        density="compact"
                        variant="outlined"
                        hide-details
                        style="max-width: 300px"
                        label="Rows"
                      />
                    </div>

                    <div class="tf-right">
                      <v-pagination
                        v-model="page"
                        :length="pageCount"
                        :total-visible="isMobile ? 3 : 7"
                        density="comfortable"
                      >
                        <template #first>
                          <v-icon icon="mdi-page-first" size="18" />
                        </template>
                        <template #prev>
                          <v-icon icon="mdi-chevron-left" size="18" />
                        </template>
                        <template #next>
                          <v-icon icon="mdi-chevron-right" size="18" />
                        </template>
                        <template #last>
                          <v-icon icon="mdi-page-last" size="18" />
                        </template>
                      </v-pagination>
                    </div>
                  </div>
                </template>
              </v-data-table>
            </div>

            <!-- MOBILE: CARD VIEW -->
            <div v-else class="mobile-list">
              <div v-if="loading" class="py-4">
                <v-skeleton-loader type="list-item-three-line@4" />
              </div>

              <template v-else>
                <div
                  v-if="!filtered.length"
                  class="text-center py-6 text-medium-emphasis text-caption"
                >
                  No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
                </div>

                <div
                  v-for="item in visibleRows"
                  :key="item._id"
                  class="booking-card"
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

                    <v-chip :color="statusColor(item.status)" size="small" label class="bc-status-chip">
                      <v-icon :icon="statusIcon(item.status)" size="16" class="mr-1" />
                      {{ item.status }}
                    </v-chip>
                  </div>

                  <!-- requester + assignee -->
                  <div class="bc-middle">
                    <div class="bc-requester">
                      <div class="bc-req-name">
                        {{ item.employee?.name || '—' }}
                      </div>
                      <div class="bc-req-meta text-caption text-medium-emphasis">
                        {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                      </div>
                    </div>
                    <div class="bc-assignee">
                      <template v-if="assigneeName(item)">
                        <v-chip
                          :color="assigneeColor(item)"
                          size="x-small"
                          class="assignee-chip"
                          label
                        >
                          <v-icon :icon="assigneeIcon(item)" size="14" class="mr-1" />
                          {{ assigneeName(item) }}
                        </v-chip>
                      </template>
                      <template v-else>
                        <v-chip
                          color="grey"
                          size="x-small"
                          variant="tonal"
                          class="assignee-chip"
                          label
                        >
                          <v-icon icon="mdi-account-off-outline" size="14" class="mr-1" />
                          Unassigned
                        </v-chip>
                      </template>
                    </div>
                  </div>

                  <!-- body: destination, purpose, driver response -->
                  <div class="bc-body">
                    <div class="lbl">Destination</div>
                    <div class="bc-itinerary">
                      {{ prettyStops(item.stops) }}
                      <v-btn
                        v-if="item.ticketUrl"
                        size="x-small"
                        color="indigo"
                        variant="tonal"
                        class="ml-2"
                        @click.stop="openTicket(item.ticketUrl)"
                      >
                        <v-icon icon="mdi-paperclip" size="14" class="mr-1" />
                        Ticket
                      </v-btn>
                    </div>

                    <div class="lbl mt-2">Purpose</div>
                    <div class="purpose-text-mobile">
                      {{ item.purpose || '—' }}
                    </div>

                    <div class="lbl mt-2">Driver response</div>
                    <div>
                      <v-chip :color="ackColor(item.assignment?.driverAck || 'PENDING')" size="x-small" label>
                        <v-icon :icon="ackIcon(item.assignment?.driverAck || 'PENDING')" size="14" class="mr-1" />
                        {{ item.assignment?.driverAck || 'PENDING' }}
                      </v-chip>
                    </div>
                  </div>

                  <!-- bottom: pax + actions -->
                  <div class="bc-bottom">
                    <div class="text-caption text-medium-emphasis">
                      Pax: <strong>{{ item.passengers ?? 1 }}</strong>
                    </div>

                    <div class="bc-actions">
                      <v-btn
                        size="x-small"
                        variant="text"
                        color="primary"
                        @click.stop="openEditDialog(item)"
                      >
                        <v-icon icon="mdi-calendar-clock" size="16" class="mr-1" />
                        Edit
                      </v-btn>

                      <v-menu location="bottom end">
                        <template #activator="{ props }">
                          <v-btn
                            v-bind="props"
                            size="x-small"
                            variant="tonal"
                            color="primary"
                            :loading="!!updating[item._id]"
                            :disabled="!hasAssignee(item)"
                          >
                            <v-icon icon="mdi-sync" size="16" class="mr-1" />
                            Next
                          </v-btn>
                        </template>
                        <v-list density="compact" min-width="220">
                          <v-list-subheader>Next status</v-list-subheader>
                          <template v-if="nextStatuses(item.status).length">
                            <v-list-item
                              v-for="s in nextStatuses(item.status)"
                              :key="s"
                              @click.stop="updateStatus(item, s)"
                            >
                              <template #prepend>
                                <v-icon :icon="statusIcon(s)" size="18" />
                              </template>
                              <v-list-item-title>{{ s }}</v-list-item-title>
                            </v-list-item>
                          </template>
                          <v-list-item v-else disabled>
                            <template #prepend>
                              <v-icon icon="mdi-lock-outline" size="18" />
                            </template>
                            <v-list-item-title>No further changes</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>

                      <v-btn
                        size="x-small"
                        variant="text"
                        color="secondary"
                        @click.stop="openAssignDialog(item)"
                      >
                        <v-icon icon="mdi-badge-account-horizontal-outline" size="16" class="mr-1" />
                        Assign
                      </v-btn>

                      <v-btn
                        size="x-small"
                        variant="text"
                        color="secondary"
                        @click.stop="showDetails(item)"
                      >
                        <v-icon icon="mdi-information-outline" size="16" class="mr-1" />
                        Details
                      </v-btn>
                    </div>
                  </div>
                </div>
              </template>

              <!-- same footer for mobile -->
              <div class="table-footer mt-2">
                <div class="tf-left">
                  <div class="text-caption text-medium-emphasis">
                    {{ page }} / {{ pageCount }}
                  </div>
                </div>
                <div class="tf-middle" />
                <div class="tf-right">
                  <v-pagination
                    v-model="page"
                    :length="pageCount"
                    :total-visible="3"
                    density="comfortable"
                  >
                    <template #prev>
                      <v-icon icon="mdi-chevron-left" size="18" />
                    </template>
                    <template #next>
                      <v-icon icon="mdi-chevron-right" size="18" />
                    </template>
                  </v-pagination>
                </div>
              </div>
            </div>
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
              <v-icon
                :icon="detailItem?.category === 'Car' ? 'mdi-car' : 'mdi-motorbike'"
                size="16"
              />
              <span class="ml-2">{{ detailItem?.category || '—' }}</span>
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
              <div class="lbl">Date</div>
              <div class="val">{{ detailItem?.tripDate || '—' }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="lbl">Passengers</div>
              <div class="val">{{ detailItem?.passengers ?? 1 }}</div>
            </v-col>

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
              <div class="lbl">Destination</div>
              <div class="val">
                <div v-if="(detailItem?.stops || []).length" class="stops">
                  <div v-for="(s,i) in detailItem.stops" :key="i" class="stop">
                    <v-icon
                      :icon="s.destination === 'Airport' ? 'mdi-airplane-takeoff' : 'mdi-map-marker'"
                      size="16"
                      class="mr-1"
                    />
                    <strong>#{{ i+1 }}:</strong>
                    <span>{{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}</span>
                    <a
                      v-if="s.mapLink"
                      :href="absUrl(s.mapLink)"
                      target="_blank"
                      rel="noopener"
                      class="ml-2 text-decoration-none"
                    >
                      <v-btn size="x-small" variant="text" color="primary">
                        <v-icon icon="mdi-link-variant" size="16" class="mr-1 link-icon" />
                        Map
                      </v-btn>
                    </a>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">Driver Response</div>
              <div class="val">
                <v-chip :color="ackColor(detailItem?.assignment?.driverAck || 'PENDING')" size="small" label>
                  <v-icon :icon="ackIcon(detailItem?.assignment?.driverAck || 'PENDING')" size="16" class="mr-1" />
                  {{ detailItem?.assignment?.driverAck || 'PENDING' }}
                </v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="6" v-if="detailItem?.ticketUrl">
              <div class="lbl">Ticket</div>
              <div class="val">
                <a
                  :href="absUrl(detailItem.ticketUrl)"
                  target="_blank"
                  rel="noopener"
                  class="text-decoration-none"
                >
                  <v-btn size="small" color="indigo" variant="tonal">
                    <v-icon icon="mdi-paperclip" size="16" class="mr-2" />
                    VIEW TICKET
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

    <!-- Edit schedule dialog -->
    <v-dialog v-model="editOpen" max-width="520">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-icon icon="mdi-calendar-clock" size="20" />
            <span>Edit schedule</span>
          </div>
          <v-btn icon variant="text" @click="editOpen = false">
            <v-icon icon="mdi-close" />
          </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-alert
            v-if="editError"
            type="error"
            variant="tonal"
            border="start"
            class="mb-3"
          >
            {{ editError }}
          </v-alert>

          <v-row dense>
            <v-col cols="12">
              <v-text-field
                v-model="editForm.tripDate"
                type="date"
                label="Trip date"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>

            <v-col cols="6">
              <v-select
                v-model="editForm.timeStartHour"
                :items="HOURS"
                label="Start hour"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="editForm.timeStartMinute"
                :items="MINUTES"
                label="Start minute"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>

            <v-col cols="6">
              <v-select
                v-model="editForm.timeEndHour"
                :items="HOURS"
                label="End hour"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="editForm.timeEndMinute"
                :items="MINUTES"
                label="End minute"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>

            <v-col cols="12">
              <v-select
                v-model="editForm.category"
                :items="['Car','Messenger']"
                label="Category"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="editOpen = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="editLoading"
            @click="saveEdit"
          >
            <v-icon icon="mdi-content-save" size="18" class="mr-2" />
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Assign dialog -->
    <v-dialog v-model="assignOpen" max-width="920">
      <v-card class="soft-card" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-icon icon="mdi-badge-account-horizontal-outline" size="20" />
            <span class="ml-2">Assign to Driver or Messenger</span>
          </div>
          <v-btn icon variant="text" @click="assignOpen = false">
            <v-icon icon="mdi-close" />
          </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text>
          <div class="d-flex align-center mb-3" style="gap:10px;">
            <v-btn-toggle
              v-model="assignRole"
              mandatory
              density="comfortable"
              rounded="xl"
              divided
            >
              <v-btn
                value="DRIVER"
                :disabled="assignLockedRole === 'MESSENGER'"
              >
                <v-icon icon="mdi-car" size="18" class="mr-2" />
                Car Driver
              </v-btn>
              <v-btn
                value="MESSENGER"
                :disabled="assignLockedRole === 'DRIVER'"
              >
                <v-icon icon="mdi-motorbike" size="18" class="mr-2" />
                Messenger
              </v-btn>
            </v-btn-toggle>
          </div>

          <v-alert
            v-if="assignError"
            type="error"
            variant="tonal"
            border="start"
            class="mb-3"
          >
            {{ assignError }}
          </v-alert>

          <template v-if="!people.length">
            <v-skeleton-loader type="card, card, card" />
          </template>

          <template v-else>
            <v-row dense>
              <v-col
                v-for="p in people"
                :key="p._id"
                cols="12"
                sm="6"
                md="4"
                lg="3"
              >
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
                      <v-avatar size="44">
                        <v-icon icon="mdi-account" />
                      </v-avatar>
                      <div>
                        <div class="font-weight-700">{{ p.name }}</div>
                        <div class="text-caption text-medium-emphasis mono">
                          ID: {{ p.loginId }}
                        </div>
                        <div v-if="isBusy(p.loginId)" class="text-caption text-error mt-1">
                          <v-icon icon="mdi-alert-circle-outline" size="14" class="mr-1" />
                          Busy in this window
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
          <v-btn
            color="primary"
            :disabled="!selectedLoginId"
            :loading="assignLoading"
            @click="submitAssign"
          >
            <v-icon icon="mdi-check" size="18" class="mr-2" />
            Assign
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.admin-car-page {
}

.highlight-row {
  background-color: #fff8e1 !important;
  transition: background 0.3s ease;
}
.highlight-row:hover {
  background-color: #fffbeb !important;
}

.section {
  border: 1px solid rgba(100,116,139,.18);
  background: linear-gradient(180deg, rgba(134,136,231,.06), rgba(16,185,129,.05));
  border-radius: 12px;
}
.hero {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 14px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color:#000000;
  border-bottom: 1px solid rgba(255,255,255,.25);
}
.hero-filters {
  align-items: flex-start;
}
.hero-inner {
  width: 100%;
}

.soft-card {
  border: 1px solid rgba(209,218,229,.14);
  border-radius: 12px;
  background: rgba(255,255,255,.96);
}
.subhdr {
  display:flex;
  align-items:center;
  gap:10px;
  font-weight:800;
  color:#1f2a44;
}

.table-scroll {
  overflow-x: auto;
}
.elevated {
  border: 1px solid #e9ecf3;
  border-radius: 12px;
  min-width: 880px;
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

.purpose-pill {
  display:flex;
  align-items:center;
  background: #eef2ff;
  border: 1px solid #dfe3fb;
  padding: 6px 10px;
  border-radius: 10px;
  min-height: 32px;
}
.purpose-text {
  font-weight: 500;
  font-size: .98rem;
  color:#30336b;
}

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

.link-icon {
  font-size: 16px;
}

.person-card {
  cursor: pointer;
  transition: transform .06s ease, box-shadow .06s ease, border-color .06s ease;
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

.mr-1 { margin-right: .25rem; }
.mr-2 { margin-right: .5rem; }
.ml-2 { margin-left: .5rem; }

.assignee-chip { font-weight: 600; }

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

:deep(.v-pagination .v-btn .v-icon){ line-height: 1; }

/* ===== MOBILE CARD STYLES ===== */
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

/* small gradient badge behind status chip */
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

.bc-status-chip {
  font-size: .72rem;
  box-shadow: 0 0 0 1px rgba(15,23,42,.04);
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

/* responsive tweaks */
@media (max-width: 600px){
  .admin-car-page {
    padding: 0 !important;
  }

  .section {
    border-left: none;
    border-right: none;
    border-radius: 0;
  }

  .hero {
    padding: 10px 12px;
  }

  .soft-card {
    border-radius: 10px;
    margin-inline: 0;
  }

  .elevated {
    border-radius: 10px;
    min-width: 760px;
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
