<!-- src/employee/carbooking/EmployeeCarHistory.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useDisplay } from 'vuetify'
import { useRoute } from 'vue-router'
import Swal from 'sweetalert2'

const route = useRoute()

const focusId = ref(route.query.focus || '')
const focusDate = ref(route.query.date || '')
const { smAndDown } = useDisplay()
const isMobile = computed(() => smAndDown.value)

const loading = ref(false)
const error   = ref('')
const rows    = ref([])

const selectedDate   = ref(dayjs().format('YYYY-MM-DD'))
const statusFilter   = ref('ALL')
const categoryFilter = ref('ALL')
const qSearch        = ref('')

const meId = ref(localStorage.getItem('employeeId') || '')

/* cancel state */
const cancelLoading = ref('')

/* ——— Build absolute URL to API origin for /uploads links ——— */
const API_ORIGIN = (api.defaults.baseURL || '')
  .replace(/\/api\/?$/,'')
  .replace(/\/$/,'')
function absUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`
}
function openTicket(u){
  const url = absUrl(u)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

/* ——— Focus + highlight a booking row ——— */
function scrollToBooking(id) {
  setTimeout(() => {
    const el = document.querySelector(`[data-row-id="${id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-row')
      setTimeout(() => el.classList.remove('highlight-row'), 2500)
    }
  }, 400)
}

/* ——— Data table headers ——— */
const headers = [
  { title: 'Time',        key: 'time',       sortable: true,  width: 140 },
  { title: 'Category',    key: 'category',   sortable: true,  width: 120 },
  { title: 'Requester',   key: 'requester',  sortable: true,  width: 220 },
  { title: 'Itinerary',   key: 'itinerary',  sortable: false },
  { title: 'Pax',         key: 'passengers', sortable: true,  width: 70, align: 'center' },
  { title: 'Status',      key: 'status',     sortable: true,  width: 150, align: 'end' },
  { title: '',            key: 'actions',    sortable: false, width: 140, align: 'end' }
]

/* ——— Load schedule ——— */
async function loadSchedule() {
  loading.value = true
  error.value = ''
  try {
    const params = { date: selectedDate.value }
    if (statusFilter.value !== 'ALL') params.status = statusFilter.value
    const { data } = await api.get('/admin/car-bookings', { params })
    rows.value = (Array.isArray(data) ? data : []).map(x => ({
      ...x,
      isMine: meId.value && String(x.employeeId) === String(meId.value),
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

/* ——— Colors unchanged ——— */
const statusColor = s => ({
  PENDING:'grey', ACCEPTED:'primary', ON_ROAD:'info', ARRIVING:'teal',
  COMPLETED:'success', DELAYED:'warning', CANCELLED:'error'
}[s] || 'grey')

/* ——— Font Awesome icon classes ——— */
const statusIconFA = s => ({
  PENDING:   'fa-solid fa-hourglass-half',
  ACCEPTED:  'fa-solid fa-circle-check',
  ON_ROAD:   'fa-solid fa-truck-fast',
  ARRIVING:  'fa-solid fa-flag-checkered',
  COMPLETED: 'fa-solid fa-badge-check',
  DELAYED:   'fa-solid fa-triangle-exclamation',
  CANCELLED: 'fa-solid fa-ban'
}[s] || 'fa-solid fa-hourglass-half')

function fixFA(icon) {
  return icon === 'fa-solid fa-badge-check'
    ? 'fa-solid fa-circle-check'
    : icon
}

const categoryIconFA = cat => (cat === 'Car' ? 'fa-solid fa-car' : 'fa-solid fa-motorcycle')
const stopIconFA     = dest => (dest === 'Airport' ? 'fa-solid fa-plane' : 'fa-solid fa-location-dot')

const filtered = computed(() => {
  const term = qSearch.value.trim().toLowerCase()
  return (rows.value || [])
    .filter(r => categoryFilter.value === 'ALL' || r.category === categoryFilter.value)
    .filter(r => {
      if (!term) return true
      const hay = [
        r.employee?.name, r.employee?.department, r.employeeId,
        r.purpose, r.notes, prettyStops(r.stops)
      ].join(' ').toLowerCase()
      return hay.includes(term)
    })
    .sort((a,b) => (a.timeStart || '').localeCompare(b.timeStart || ''))
})

/* ——— Cancel rules ——— */
function canCancel(item) {
  const st = String(item.status || '').toUpperCase()
  if (['ON_ROAD','ARRIVING','COMPLETED','CANCELLED'].includes(st)) return false

  if (!item.tripDate) return true
  const tripDay = dayjs(item.tripDate).startOf('day')
  const today   = dayjs().startOf('day')
  return tripDay.isSame(today, 'day') || tripDay.isAfter(today, 'day')
}

async function cancelBooking(item) {
  if (!item?._id || !item.isMine || !canCancel(item)) return

  const { isConfirmed } = await Swal.fire({
    title: 'Cancel this booking?',
    text: 'Are you sure you want to cancel this booking?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, cancel it',
    cancelButtonText: 'No'
  })

  if (!isConfirmed) return

  cancelLoading.value = String(item._id)
  try {
    await api.post(`/employee/car-bookings/${item._id}/cancel`)
    item.status = 'CANCELLED'

    await Swal.fire({
      icon: 'success',
      title: 'Cancelled',
      text: 'Your booking has been cancelled.',
      timer: 1500,
      showConfirmButton: false
    })
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to cancel booking'
    await loadSchedule()
  } finally {
    cancelLoading.value = ''
  }
}

/* ——— Socket events ——— */
function onCreated(doc) {
  if (!doc?.tripDate || doc.tripDate !== selectedDate.value) return
  const exists = rows.value.some(x => String(x._id) === String(doc._id))
  if (!exists) {
    rows.value.push({
      ...doc,
      isMine: meId.value && String(doc.employeeId) === String(meId.value),
      stops: doc.stops || []
    })
  }
}
function onStatus(p) {
  const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
  if (it) it.status = p.status
}

onMounted(() => {
  if (focusDate.value) selectedDate.value = focusDate.value
  loadSchedule().then(() => {
    if (focusId.value) scrollToBooking(focusId.value)
  })
  socket.on('carBooking:created', onCreated)
  socket.on('carBooking:status', onStatus)
})

onBeforeUnmount(() => {
  socket.off('carBooking:created', onCreated)
  socket.off('carBooking:status', onStatus)
})

watch([selectedDate, statusFilter], loadSchedule)

/* ——— Details dialog ——— */
const detailOpen = ref(false)
const detailItem = ref(null)
function showDetails(item){ detailItem.value = item; detailOpen.value = true }
function onRowClick(_e, ctx){
  const data = ctx?.item?.raw || ctx?.item || ctx
  if (data) showDetails(data)
}

/* ——— Pagination (responsive + FA footer) ——— */
const page = ref(1)
const itemsPerPage = ref(10)
const pageCount = computed(() => {
  const n = Math.ceil((filtered.value?.length || 0) / (itemsPerPage.value || 10))
  return Math.max(1, n || 1)
})
const totalItems = computed(() => filtered.value?.length || 0)
const rangeStart = computed(() =>
  totalItems.value ? (page.value - 1) * itemsPerPage.value + 1 : 0
)
const rangeEnd   = computed(() =>
  Math.min(page.value * itemsPerPage.value, totalItems.value)
)

/* Items for mobile card view (manual slice) */
const mobilePaged = computed(() => {
  const items = filtered.value || []
  const per = itemsPerPage.value || items.length || 1
  const start = (page.value - 1) * per
  return items.slice(start, start + per)
})

watch([filtered, itemsPerPage], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})
</script>

<template>
  <v-container fluid class="pa-2 history-container">
    <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
      <div class="hero">
        <div class="hero-left">
          <div class="hero-title">
            <i class="fa-solid fa-calendar-check"></i>
            <span>Day Schedule — All Requests</span>
          </div>
        </div>
        <div class="hero-right d-none d-sm-flex">
          <v-chip size="small" color="primary" label class="mr-1">Mine</v-chip>
          <v-chip size="small" label>Others</v-chip>
        </div>
      </div>

      <div class="px-3 pb-3 pt-2">
        <v-card flat class="soft-card glass mb-3 filters-card">
          <v-card-title class="subhdr">
            <i class="fa-solid fa-filter"></i><span>Filters</span>
            <v-spacer />
            <v-btn size="small" @click="loadSchedule" :loading="loading">
              <template #prepend><i class="fa-solid fa-rotate-right"></i></template>
              Refresh
            </v-btn>
          </v-card-title>
          <v-card-text class="pt-0">
            <v-row dense>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="selectedDate"
                  type="date"
                  label="Date"
                  variant="outlined"
                  density="compact"
                  hide-details
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
                  label="Search requester / purpose / destination"
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

        <v-card flat class="soft-card glass">
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

            <!-- ========== DESKTOP TABLE ========== -->
            <div v-if="!isMobile" class="table-wrapper">
              <v-data-table
                :headers="headers"
                :items="filtered"
                :loading="loading"
                item-key="_id"
                :density="isMobile ? 'compact' : 'comfortable'"
                class="elevated car-history-table align-left comfy-cells row-hover"
                v-model:page="page"
                :items-per-page="itemsPerPage"
                @click:row="onRowClick"
              >
                <template #loading>
                  <v-skeleton-loader type="table-row@6" />
                </template>

                <template #item.time="{ item }">
                  <div class="mono">
                    {{ item.timeStart }} – {{ item.timeEnd }}
                  </div>
                </template>

                <template #item.category="{ item }">
                  <v-chip
                    :color="item.category === 'Car' ? 'primary' : 'orange'"
                    size="small"
                    label
                  >
                    <i :class="categoryIconFA(item.category)" class="mr-1"></i>
                    {{ item.category }}
                  </v-chip>
                </template>

                <template #item.requester="{ item }">
                  <div class="d-flex align-center">
                    <v-chip
                      v-if="item.isMine"
                      size="x-small"
                      color="primary"
                      variant="elevated"
                      class="mr-2"
                    >
                      Mine
                    </v-chip>
                    <div>
                      <div class="font-weight-600">
                        {{ item.employee?.name || '—' }}
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                      </div>
                    </div>
                  </div>
                </template>

                <template #item.itinerary="{ item }">
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
                      <template #prepend>
                        <i class="fa-solid fa-paperclip"></i>
                      </template>
                      Ticket
                    </v-btn>
                  </div>
                  <div class="text-caption mt-1" v-if="item.purpose || item.notes">
                    <span class="text-medium-emphasis">Purpose:</span>
                    {{ item.purpose || '—' }}
                    <span v-if="item.notes">
                      • <span class="text-medium-emphasis">Notes:</span> {{ item.notes }}
                    </span>
                  </div>
                </template>

                <template #item.passengers="{ item }">
                  <div class="text-center">
                    {{ item.passengers ?? 1 }}
                  </div>
                </template>

                <template #item.status="{ item }">
                  <v-chip :color="statusColor(item.status)" size="small" label>
                    <i :class="fixFA(statusIconFA(item.status))" class="mr-1"></i>
                    {{ item.status }}
                  </v-chip>
                </template>

                <template #item.actions="{ item }">
                  <div :data-row-id="item._id" class="d-flex justify-end" style="gap:6px;">
                    <v-btn
                      v-if="item.isMine"
                      size="small"
                      variant="text"
                      color="error"
                      :disabled="!canCancel(item)"
                      :loading="cancelLoading === String(item._id)"
                      @click.stop="cancelBooking(item)"
                    >
                      <template #prepend>
                        <i class="fa-solid fa-ban"></i>
                      </template>
                      Cancel
                    </v-btn>

                    <v-btn
                      size="small"
                      variant="tonal"
                      color="primary"
                      @click.stop="showDetails(item)"
                    >
                      <template #prepend>
                        <i class="fa-solid fa-circle-info"></i>
                      </template>
                      Details
                    </v-btn>
                  </div>
                </template>

                <!-- ✅ Desktop bottom footer -->
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
            </div>

            <!-- ========== MOBILE CARD LIST ========== -->
            <div v-else class="mobile-list">
              <div v-if="loading" class="py-4">
                <v-skeleton-loader type="list-item-three-line@4" />
              </div>

              <div v-else>
                <div
                  v-if="!filtered.length"
                  class="text-center py-6 text-medium-emphasis text-caption"
                >
                  No bookings found.
                </div>

                <div
                  v-for="item in mobilePaged"
                  :key="item._id"
                  class="booking-card"
                  :data-row-id="item._id"
                  @click="showDetails(item)"
                >
                  <!-- top: time + status -->
                  <div class="bc-top">
                    <div>
                      <div class="bc-time mono">
                        {{ item.timeStart }} – {{ item.timeEnd }}
                      </div>
                      <div class="bc-date text-caption">
                        {{ item.tripDate || '—' }}
                      </div>
                    </div>
                    <v-chip
                      :color="statusColor(item.status)"
                      size="small"
                      label
                      class="bc-status-chip"
                    >
                      <i :class="fixFA(statusIconFA(item.status))" class="mr-1"></i>
                      {{ item.status }}
                    </v-chip>
                  </div>

                  <!-- middle: category + requester -->
                  <div class="bc-middle">
                    <div class="d-flex align-center" style="gap:6px;">
                      <v-chip
                        :color="item.category === 'Car' ? 'primary' : 'orange'"
                        size="x-small"
                        label
                      >
                        <i :class="categoryIconFA(item.category)" class="mr-1"></i>
                        {{ item.category }}
                      </v-chip>

                      <v-chip
                        v-if="item.isMine"
                        size="x-small"
                        color="primary"
                        variant="elevated"
                      >
                        Mine
                      </v-chip>
                    </div>
                    <div class="bc-requester">
                      <div class="font-weight-600">
                        {{ item.employee?.name || '—' }}
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
                      </div>
                    </div>
                  </div>

                  <!-- body: itinerary + purpose -->
                  <div class="bc-body">
                    <div class="lbl">Route</div>
                    <div class="val">
                      {{ prettyStops(item.stops) }}
                      <v-btn
                        v-if="item.ticketUrl"
                        size="x-small"
                        color="indigo"
                        variant="tonal"
                        class="ml-2"
                        @click.stop="openTicket(item.ticketUrl)"
                      >
                        <template #prepend>
                          <i class="fa-solid fa-paperclip"></i>
                        </template>
                        Ticket
                      </v-btn>
                    </div>

                    <div
                      class="text-caption mt-2"
                      v-if="item.purpose || item.notes"
                    >
                      <span class="text-medium-emphasis">Purpose:</span>
                      {{ item.purpose || '—' }}
                      <span v-if="item.notes">
                        • <span class="text-medium-emphasis">Notes:</span> {{ item.notes }}
                      </span>
                    </div>
                  </div>

                  <!-- bottom: pax + actions -->
                  <div class="bc-bottom">
                    <div class="text-caption text-medium-emphasis">
                      Pax: <strong>{{ item.passengers ?? 1 }}</strong>
                    </div>

                    <div class="bc-actions">
                      <v-btn
                        v-if="item.isMine"
                        size="small"
                        variant="text"
                        color="error"
                        :disabled="!canCancel(item)"
                        :loading="cancelLoading === String(item._id)"
                        @click.stop="cancelBooking(item)"
                      >
                        <template #prepend>
                          <i class="fa-solid fa-ban"></i>
                        </template>
                        Cancel
                      </v-btn>

                      <v-btn
                        size="small"
                        variant="tonal"
                        color="primary"
                        @click.stop="showDetails(item)"
                      >
                        <template #prepend>
                          <i class="fa-solid fa-circle-info"></i>
                        </template>
                        Details
                      </v-btn>
                    </div>
                  </div>
                </div>

                <!-- mobile footer / pagination -->
                <div class="table-footer mt-1" v-if="pageCount > 1">
                  <div class="tf-left">
                    <div class="text-caption text-medium-emphasis d-none d-sm-inline">
                      Showing {{ rangeStart }}–{{ rangeEnd }} of {{ totalItems }}
                    </div>
                    <div class="text-caption text-medium-emphasis d-sm-none">
                      {{ page }} / {{ pageCount }}
                    </div>
                  </div>

                  <div class="tf-middle">
                    <!-- no rows-per-page selector on mobile -->
                  </div>

                  <div class="tf-right">
                    <v-pagination
                      v-model="page"
                      :length="pageCount"
                      :total-visible="3"
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
              </div>
            </div>
          </v-card-text>
        </v-card>
      </div>
    </v-sheet>

    <!-- Details dialog -->
    <v-dialog v-model="detailOpen" max-width="820">
      <v-card class="soft-card glass" rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center" style="gap:10px;">
            <v-chip
              :color="detailItem?.category === 'Car' ? 'primary' : 'orange'"
              size="small"
              label
            >
              <i :class="categoryIconFA(detailItem?.category)" class="mr-1"></i>
              {{ detailItem?.category || '—' }}
            </v-chip>
            <span class="mono">
              {{ detailItem?.timeStart }} – {{ detailItem?.timeEnd }}
            </span>
          </div>
          <v-btn variant="text" @click="detailOpen = false" icon>
            <i class="fa-solid fa-xmark"></i>
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

            <v-col cols="12" md="6" v-if="detailItem?.customerContact">
              <div class="lbl">Customer Contact</div>
              <div class="val">{{ detailItem?.customerContact }}</div>
            </v-col>

            <v-col cols="12">
              <div class="lbl">Itinerary</div>
              <div class="val">
                <div v-if="(detailItem?.stops || []).length" class="stops">
                  <div
                    v-for="(s,i) in detailItem.stops"
                    :key="i"
                    class="stop"
                  >
                    <i :class="stopIconFA(s.destination)" class="mr-1"></i>
                    <strong>#{{ i+1 }}:</strong>
                    <span>
                      {{ s.destination === 'Other' ? (s.destinationOther || 'Other') : s.destination }}
                    </span>
                    <a
                      v-if="s.mapLink"
                      :href="absUrl(s.mapLink)"
                      target="_blank"
                      rel="noopener"
                      class="ml-2 text-decoration-none"
                    >
                      <v-btn size="x-small" variant="text" color="primary">
                        <template #prepend>
                          <i class="fa-solid fa-link"></i>
                        </template>
                        Map
                      </v-btn>
                    </a>
                  </div>
                </div>
                <div v-else>—</div>
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="lbl">Status</div>
              <div class="val">
                <v-chip :color="statusColor(detailItem?.status)" size="small" label>
                  <i :class="fixFA(statusIconFA(detailItem?.status))" class="mr-1"></i>
                  {{ detailItem?.status || '—' }}
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
                    <template #prepend>
                      <i class="fa-solid fa-paperclip"></i>
                    </template>
                    VIEW TICKET
                  </v-btn>
                </a>
              </div>
            </v-col>

            <v-col
              cols="12"
              v-if="detailItem?.purpose || detailItem?.notes"
              class="mt-1"
            >
              <div class="lbl">Purpose & Notes</div>
              <div class="val">
                <div>
                  <span class="text-medium-emphasis">Purpose:</span>
                  {{ detailItem?.purpose || '—' }}
                </div>
                <div v-if="detailItem?.notes">
                  <span class="text-medium-emphasis">Notes:</span>
                  {{ detailItem?.notes }}
                </div>
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
  </v-container>
</template>

<style scoped>
.section {
  background: linear-gradient(180deg, rgba(134,136,231,.06), rgba(16,185,129,.05));
  border: 1px solid rgba(100,116,139,.18);
  border-radius: 16px;
}
.hero {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 14px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #6ca9f5 45%, #ae9aea 100%);
  color:#fff;
}
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card {
  border: 1px solid rgba(209,218,229,.14);
  border-radius: 14px;
}
.glass {
  background: radial-gradient(circle at 0 0, rgba(59,130,246,.06), transparent 60%),
              radial-gradient(circle at 100% 100%, rgba(45,212,191,.06), transparent 60%),
              rgba(255,255,255,.85);
  backdrop-filter: blur(8px);
}
.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; }

.elevated {
  border: 1px solid rgba(100,116,139,.14);
  border-radius: 12px;
}

/* table wrapper for horizontal scroll */
.table-wrapper {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* filters card slightly tighter */
.filters-card {
  margin-bottom: 12px;
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

/* ---------- Match other tables: left align + comfy + row hover ---------- */
.align-left :deep(table thead th),
.align-left :deep(table tbody td){
  text-align: left !important;
}
.comfy-cells :deep(table tbody td){
  vertical-align: top;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
.comfy-cells :deep(table thead th){
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
.row-hover :deep(table tbody tr:hover){
  background: rgba(59,130,246,0.08);
  transition: background 120ms ease;
}

/* ——— Footer ——— */
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

/* tighter pagination buttons and icon alignment */
:deep(.v-pagination .v-btn){ min-width: 36px; }
:deep(.v-pagination .v-btn i.fa-solid){ line-height: 1; }

/* ========== MOBILE CARD STYLES ========== */
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
  margin-top: 1px;
  font-size:.75rem;
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
  margin-top: 2px;
  position: relative;
  z-index: 1;
}

.bc-requester {
  text-align: right;
}

.bc-body {
  font-size: .8rem;
  margin-top: 4px;
  position: relative;
  z-index: 1;
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
  gap:4px;
}

/* On very narrow screens, stretch footer sections to full width */
@media (max-width: 600px){
  .history-container {
    padding: 0 !important;
  }

  .section {
    border: none;
    border-radius: 0;
  }

  .hero {
    border-radius: 0;
    padding: 10px 14px;
  }

  .hero-title {
    font-size: 0.95rem;
    gap: 8px;
  }

  .soft-card {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .filters-card {
    margin-bottom: 8px;
  }

  .table-footer {
    padding: 8px 10px;
    gap: 8px;
  }
  .tf-left,
  .tf-middle,
  .tf-right {
    width: 100%;
  }
  .tf-right {
    justify-content: flex-end;
  }
}

/* ——— Highlight animation when coming from calendar ——— */
.highlight-row {
  animation: rowFlash 2.2s ease-in-out;
}
@keyframes rowFlash {
  0%   { background-color: #fef9c3; }
  50%  { background-color: #fef08a; }
  100% { background-color: transparent; }
}
</style>
