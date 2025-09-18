<!-- src/views/employee/EmployeeRequestHistory.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import api from '@/utils/api'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'


const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL') // default ALL, avoids hide of DELIVERED/CANCELED
const statuses = ['ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']

const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({ ...o, _id: String(o?._id || '') })

function passFilters(doc) {
  if (!doc) return false
  if (employeeId.value && String(doc?.employee?.employeeId) !== String(employeeId.value)) return false
  if (status.value !== 'ALL' && doc.status !== status.value) return false
  if (q.value.trim()) {
    const rx = new RegExp(q.value.trim(), 'i')
    const hay = [doc.orderType, doc.menuType, doc?.location?.kind, doc.specialInstructions].filter(Boolean).join(' ')
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
    const { data } = await api.get(`/public/food-requests?${params.toString()}`)
    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    rows.value = list.map(normalize)
    console.log('[emp/history] loaded', rows.value.length, 'rows')
  } finally { loading.value = false }
}

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

watch([q, status], () => load())
const isAdmin = computed(() => false) // UI only; hidden for employees
async function acceptRequest(row) {}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg" elevation="1">
      <v-toolbar flat density="comfortable">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          My Requests <v-chip size="x-small" class="ml-2" color="teal" label>Live</v-chip>
        </v-toolbar-title>
        <v-spacer />
        <v-text-field v-model="q" density="compact" placeholder="Search (type, location, note)"
          hide-details variant="outlined" class="mr-2" @keyup.enter="load" />
        <v-select v-model="status" :items="statuses" density="compact" label="Status"
          hide-details variant="outlined" class="mr-2" style="max-width:160px" />
        <!-- optional manual refresh kept for safety -->
        <v-btn :loading="loading" color="primary" @click="load">Refresh</v-btn>
      </v-toolbar>
      <v-divider />
      <v-card-text class="pa-0">
        <v-table density="comfortable">
          <thead>
            <tr>
              <th style="width: 140px;">Serve Date</th>
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
            <tr v-for="r in rows" :key="r._id">
              <td>{{ fmtDate(r.serveDate) }}</td>
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
              <td>
                <span class="text-disabled">—</span>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="9" class="text-center py-6 text-medium-emphasis">No requests found.</td></tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>
