<!-- src/views/admin/AdminFoodRequests.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

const auth = useAuth()

const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ACTIVE')

const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 25, 50, 100]

const statuses = ['ACTIVE','ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const COLOR = { NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({ ...o, _id: String(o?._id || ''), requestId: String(o?.requestId || '') })

function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (status.value === 'ACTIVE' && ['DELIVERED','CANCELED'].includes(d.status)) {
    if (i !== -1) rows.value.splice(i, 1)
    return
  }
  if (i === -1) rows.value.unshift(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value.trim()) params.set('q', q.value.trim())
    if (status.value && status.value !== 'ALL' && status.value !== 'ACTIVE') params.set('status', status.value)
    const { data } = await api.get(`/admin/food-requests?${params.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    if (status.value === 'ACTIVE') list = list.filter(r => !['DELIVERED','CANCELED'].includes(r.status))
    rows.value = list.map(normalize)
    page.value = 1
    console.log('[adm/requests] loaded', rows.value.length, 'rows')
  } finally { loading.value = false }
}

onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await load()

  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id||'')))
})

onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})

watch([q, status], () => { page.value = 1; load() })

const totalItems = computed(() => rows.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / perPage.value)))
const pagedRows = computed(() => {
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

const nextSteps = (s) => {
  switch (s) {
    case 'NEW': return ['ACCEPTED','CANCELED']
    case 'ACCEPTED': return ['COOKING','CANCELED']
    case 'COOKING': return ['READY','CANCELED']
    case 'READY': return ['DELIVERED','CANCELED']
    default: return []
  }
}

async function updateStatus(row, target) {
  if (!row?._id) {
    await Swal.fire({ icon:'error', title:'Missing _id', text:'This row has no Mongo _id. Cannot update.' })
    return
  }

  const ok = await Swal.fire({
    icon: 'question',
    title: `Set status: ${target}?`,
    text: `Request by ${row.employee?.name} on ${fmtDate(row.serveDate)}.`,
    showCancelButton: true,
    confirmButtonText: 'Yes, update',
    cancelButtonText: 'No',
  })
  if (!ok.isConfirmed) return

  const before = { ...row }
  try {
    const url = `/admin/food-requests/${encodeURIComponent(row._id)}/status`
    const { data: updated } = await api.patch(url, { status: target })
    upsertRow(updated)
    await Swal.fire({ icon:'success', title:'Updated', timer:900, showConfirmButton:false })
  } catch (e) {
    upsertRow(before)
    await Swal.fire({ icon:'error', title:'Failed', text: e?.response?.data?.message || e.message || 'Request failed' })
  }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card elevation="1" class="rounded-lg">
      <v-toolbar flat density="comfortable">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">Food Requests (Admin/Chef)</v-toolbar-title>
        <v-spacer />
        <v-text-field v-model="q" density="compact" placeholder="Search (type, location, note)" hide-details variant="outlined" class="mr-2" @keyup.enter="load" />
        <v-select v-model="status" :items="statuses" density="compact" label="Status" hide-details variant="outlined" class="mr-2" style="max-width: 160px" />
        <v-select v-model="perPage" :items="perPageOptions" density="compact" label="Rows" hide-details variant="outlined" style="max-width: 120px" class="mr-2" />
        <v-btn :loading="loading" color="primary" @click="load">Refresh</v-btn>
      </v-toolbar>

      <v-divider />
      <v-card-text class="pa-0">
        <v-table density="comfortable">
          <thead>
            <tr>
              <th style="width: 140px;">Serve Date</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Meals</th>
              <th>Qty</th>
              <th>Location</th>
              <th>Menu</th>
              <th>Recurring</th>
              <th>Status</th>
              <th style="width: 280px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRows" :key="r._id">
              <td>{{ fmtDate(r.serveDate) }}</td>
              <td>{{ r.employee?.employeeId }} — {{ r.employee?.name }}</td>
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
              <td><v-chip :color="COLOR[r.status]" size="small" label>{{ r.status }}</v-chip></td>
              <td>
                <v-btn
                  v-for="s in nextSteps(r.status)" :key="s"
                  size="small" class="mr-1 mb-1"
                  :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                  variant="tonal"
                  :disabled="!r._id"
                  @click="updateStatus(r, s)"
                >{{ s }}</v-btn>
              </td>
            </tr>
            <tr v-if="!pagedRows.length">
              <td colspan="10" class="text-center py-6 text-medium-emphasis">No requests found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>

      <v-divider />
      <div class="d-flex align-center justify-space-between px-4 py-3">
        <div class="text-caption text-medium-emphasis">
          Showing
          <b>{{ Math.min((page - 1) * perPage + 1, totalItems) }}</b>
          -
          <b>{{ Math.min(page * perPage, totalItems) }}</b>
          of <b>{{ totalItems }}</b>
        </div>
        <v-pagination v-model="page" :length="totalPages" :total-visible="7" density="comfortable" />
      </div>
    </v-card>
  </v-container>
</template>
