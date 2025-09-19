<!-- src/views/employee/EmployeeRequestHistory.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import api from '@/utils/api'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import Swal from 'sweetalert2'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'
import * as XLSX from 'xlsx'

// enable plugins
dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

/* ───────── state ───────── */
const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL')
const statuses = ['ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* date filter */
const dateStart = ref('')
const dateEnd = ref('')

/* pagination */
const page = ref(1)
const itemsPerPage = ref(20)
const itemsPerPageOptions = [20, 50, 100, 'All']

/* ───────── computed ───────── */
const filteredRows = computed(() => {
  let list = rows.value
  if (dateStart.value) {
    list = list.filter(r =>
      r.serveDate && dayjs(r.serveDate).isSameOrAfter(dayjs(dateStart.value), 'day')
    )
  }
  if (dateEnd.value) {
    list = list.filter(r =>
      r.serveDate && dayjs(r.serveDate).isSameOrBefore(dayjs(dateEnd.value), 'day')
    )
  }
  return list
})

const pagedRows = computed(() => {
  if (itemsPerPage.value === 'All') return filteredRows.value
  const start = (page.value - 1) * itemsPerPage.value
  return filteredRows.value.slice(start, start + itemsPerPage.value)
})
const pageCount = computed(() => {
  if (itemsPerPage.value === 'All') return 1
  return Math.ceil(filteredRows.value.length / itemsPerPage.value) || 1
})

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({ ...o, _id: String(o?._id || '') })

function passFilters(doc) {
  if (!doc) return false
  if (employeeId.value && String(doc?.employee?.employeeId) !== String(employeeId.value)) return false
  if (status.value !== 'ALL' && doc.status !== status.value) return false
  if (q.value.trim()) {
    const rx = new RegExp(q.value.trim(), 'i')
    const hay = [
      doc.orderType,
      doc.menuType,
      doc?.location?.kind,
      doc?.employee?.name,
      doc.specialInstructions,
    ].filter(Boolean).join(' ')
    if (!rx.test(hay)) return false
  }
  return true
}
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (passFilters(d)) {
    if (i === -1) rows.value.unshift(d)
    else rows.value[i] = d
  } else if (i !== -1) {
    rows.value.splice(i, 1)
  }
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (employeeId.value) params.set('employeeId', employeeId.value)
    if (status.value !== 'ALL') params.set('status', status.value)
    if (q.value.trim()) params.set('q', q.value.trim())
    if (dateStart.value) params.set('dateStart', dateStart.value)
    if (dateEnd.value) params.set('dateEnd', dateEnd.value)
    const { data } = await api.get(`/public/food-requests?${params.toString()}`)
    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    rows.value = list.map(normalize)
    console.log('[emp/history] loaded', rows.value.length, 'rows')
    page.value = 1 // reset page
  } finally { loading.value = false }
}

/* export to excel */
function exportExcel() {
  const exportData = filteredRows.value.map(r => ({
    'Serve Date': fmtDate(r.serveDate),
    'Employee ID': r?.employee?.employeeId,
    'Employee Name': r?.employee?.name,
    'Type': r.orderType,
    'Meals': (r.meals || []).join(', '),
    'Quantity': r.quantity,
    'Location': r?.location?.kind + (r?.location?.other ? ' — ' + r.location.other : ''),
    'Menu': r.menuType,
    'Recurring': r.recurring?.enabled ? r.recurring.frequency : '—',
    'Status': r.status,
  }))
  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Requests')
  XLSX.writeFile(wb, 'EmployeeRequests.xlsx')
}

/* sockets */
function registerSocket() {
  socket.on('foodRequest:created', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({ toast:true, icon:'success', title:'New request submitted', position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:updated', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
  })
  socket.on('foodRequest:statusChanged', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({ toast:true, icon:'info', title:`Status: ${doc.status}`, position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:deleted', ({ _id }) => {
    removeRowById(String(_id || ''))
    Swal.fire({ toast:true, icon:'warning', title:'Request deleted', position:'top', timer:1200, showConfirmButton:false })
  })
}
function unregisterSocket() {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
}

onMounted(async () => {
  console.log('[emp/history] mounted; employeeId=', employeeId.value)
  subscribeEmployeeIfNeeded()
  await load()
  registerSocket()
})
onBeforeUnmount(() => { unregisterSocket() })

watch([q, status, dateStart, dateEnd], () => load())
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg" elevation="1">
      <v-toolbar flat density="comfortable">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          My Requests <v-chip size="x-small" class="ml-2" color="teal" label>Live</v-chip>
        </v-toolbar-title>
        <v-spacer />
        <v-text-field v-model="q" density="compact" placeholder="Search (type, location, employee, note)"
          hide-details variant="outlined" class="mr-2" @keyup.enter="load" />
        <v-select v-model="status" :items="statuses" density="compact" label="Status"
          hide-details variant="outlined" class="mr-2" style="max-width:160px" />
        <v-text-field v-model="dateStart" type="date" density="compact" label="From"
          hide-details variant="outlined" class="mr-2" style="max-width:160px" />
        <v-text-field v-model="dateEnd" type="date" density="compact" label="To"
          hide-details variant="outlined" class="mr-2" style="max-width:160px" />
        <v-btn :loading="loading" color="primary" @click="load" class="mr-2">Refresh</v-btn>
        <v-btn color="success" @click="exportExcel">Export</v-btn>
      </v-toolbar>
      <v-divider />
      <v-card-text class="pa-0">
        <v-table density="comfortable">
          <thead>
            <tr>
              <th style="width: 140px;">Serve Date</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Meal(s)</th>
              <th>Qty</th>
              <th>Location</th>
              <th>Menu</th>
              <th>Recurring</th>
              <th>Status</th>
              <th style="width: 160px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRows" :key="r._id">
              <td>{{ fmtDate(r.serveDate) }}</td>
              <td>{{ r?.employee?.name || '—' }}</td>
              <td>{{ r.orderType }}</td>
              <td>{{ (r.meals || []).join(', ') }}</td>
              <td>{{ r.quantity }}</td>
              <td>{{ r?.location?.kind }}<span v-if="r?.location?.other">— {{ r.location.other }}</span></td>
              <td>{{ r.menuType }}</td>
              <td>
                <template v-if="r.recurring?.enabled">
                  <v-chip color="teal" size="small" label class="mb-1">{{ r.recurring?.frequency }}</v-chip>
                  <div class="text-caption">
                    <span v-if="r.recurring?.endDate">until {{ fmtDate(r.recurring?.endDate) }}</span>
                    <span v-if="r.recurring?.skipHolidays" class="ml-1">(skip holidays)</span>
                  </div>
                </template>
                <span v-else>—</span>
              </td>
              <td>
                <v-chip :color="{ NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }[r.status]" size="small" label>
                  {{ r.status }}
                </v-chip>
              </td>
              <td><span class="text-disabled">—</span></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="10" class="text-center py-6 text-medium-emphasis">No requests found.</td></tr>
          </tbody>
        </v-table>

        <!-- pagination -->
        <div class="d-flex justify-space-between align-center pa-3">
          <v-select v-model="itemsPerPage" :items="itemsPerPageOptions" density="compact"
            label="Rows per page" hide-details variant="outlined" style="max-width:120px" />
          <v-pagination v-model="page" :length="pageCount" :total-visible="7" />
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>
