<!-- src/views/expat/ExpatLeaveHome.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'

const auth = useAuth()

const loadingProfile = ref(false)
const loadingRequests = ref(false)
const saving = ref(false)
const error = ref('')

const profile = ref(null)
const leaveTypes = ref([])
const requests = ref([])

/* ---------- Form state ---------- */
const form = ref({
  leaveTypeCode: '',
  startDate: dayjs().format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD'),
  reason: '',
})

/* ---------- Derived ---------- */
const userName = computed(() => auth.user?.name || 'Expat')

const leaveTypeOptions = computed(() =>
  leaveTypes.value.map(t => ({
    code: t.code,
    label: t.label || t.nameEn || t.name || t.code,
  }))
)

const pendingCount = computed(
  () => requests.value.filter(r => r.status === 'PENDING').length
)
const approvedCount = computed(
  () => requests.value.filter(r => r.status === 'APPROVED').length
)
const rejectedCount = computed(
  () => requests.value.filter(r => r.status === 'REJECTED').length
)

/* ---------- API calls ---------- */
async function loadProfile() {
  try {
    loadingProfile.value = true
    const res = await api.get('/leave/profile/me')
    profile.value = res.data
  } catch (e) {
    console.error(e)
    error.value = 'Failed to load leave profile'
  } finally {
    loadingProfile.value = false
  }
}

async function loadLeaveTypes() {
  try {
    const res = await api.get('/leave/types')
    leaveTypes.value = res.data || []
  } catch (e) {
    console.error(e)
    // not fatal
  }
}

async function loadRequests() {
  try {
    loadingRequests.value = true
    const res = await api.get('/leave/requests')
    requests.value = res.data?.items || res.data || []
  } catch (e) {
    console.error(e)
    error.value = 'Failed to load leave requests'
  } finally {
    loadingRequests.value = false
  }
}

/* ---------- Actions ---------- */
function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
    reason: '',
  }
}

async function submitRequest() {
  if (!form.value.leaveTypeCode) {
    Swal.fire('Missing type', 'Please select leave type', 'warning')
    return
  }
  if (!form.value.startDate || !form.value.endDate) {
    Swal.fire('Missing date', 'Please select start and end date', 'warning')
    return
  }

  try {
    saving.value = true
    error.value = ''

    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      reason: form.value.reason || '',
    }

    const res = await api.post('/leave/requests', payload)
    const created = res.data

    // Put newest on top
    requests.value = [created, ...requests.value]

    Swal.fire('Submitted', 'Your leave request has been sent.', 'success')
    resetForm()
  } catch (e) {
    console.error(e)
    const msg = e?.response?.data?.message || 'Failed to submit leave request'
    Swal.fire('Error', msg, 'error')
  } finally {
    saving.value = false
  }
}

function fmtDate(d) {
  return d ? dayjs(d).format('YYYY-MM-DD') : '—'
}

function fmtStatus(s) {
  switch (s) {
    case 'PENDING': return 'Pending'
    case 'APPROVED': return 'Approved'
    case 'REJECTED': return 'Rejected'
    case 'CANCELLED': return 'Cancelled'
    default: return s || 'Unknown'
  }
}

onMounted(async () => {
  await Promise.all([
    loadProfile(),
    loadLeaveTypes(),
    loadRequests(),
  ])
})
</script>

<template>
  <v-container class="py-4" fluid>
    <v-row>
      <v-col cols="12">
        <div class="page-header">
          <div>
            <h1 class="page-title">Expat Leave Request</h1>
            <p class="page-sub">
              Welcome, <strong>{{ userName }}</strong>.
              You can submit and track your leave requests here.
            </p>
          </div>
          <div class="page-meta" v-if="profile">
            <div class="meta-line">
              <v-icon size="16" class="mr-1">mdi-account-tie</v-icon>
              Manager: <strong>{{ profile.managerLoginId }}</strong>
            </div>
            <div class="meta-line">
              <v-icon size="16" class="mr-1">mdi-account-star</v-icon>
              GM: <strong>{{ profile.gmLoginId }}</strong>
            </div>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Summary -->
    <v-row class="mb-3">
      <v-col cols="12" md="4">
        <v-card class="summary-card" elevation="2">
          <div class="summary-label">Pending</div>
          <div class="summary-value">{{ pendingCount }}</div>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card class="summary-card" elevation="2">
          <div class="summary-label">Approved</div>
          <div class="summary-value">{{ approvedCount }}</div>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card class="summary-card" elevation="2">
          <div class="summary-label">Rejected</div>
          <div class="summary-value">{{ rejectedCount }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <!-- New request form -->
      <v-col cols="12" md="4">
        <v-card elevation="3" class="form-card">
          <v-card-title class="pb-1">
            New Leave Request
          </v-card-title>
          <v-card-subtitle class="pb-3">
            Fill the form and submit to your manager &amp; GM.
          </v-card-subtitle>

          <v-card-text>
            <v-select
              v-model="form.leaveTypeCode"
              :items="leaveTypeOptions"
              item-title="label"
              item-value="code"
              label="Leave type"
              density="comfortable"
              clearable
            />

            <v-text-field
              v-model="form.startDate"
              type="date"
              label="Start date"
              density="comfortable"
              class="mt-3"
            />

            <v-text-field
              v-model="form.endDate"
              type="date"
              label="End date"
              density="comfortable"
              class="mt-3"
            />

            <v-textarea
              v-model="form.reason"
              label="Reason (optional)"
              auto-grow
              rows="2"
              density="comfortable"
              class="mt-3"
            />

            <div class="mt-4 d-flex justify-end">
              <v-btn
                color="primary"
                :loading="saving"
                @click="submitRequest"
              >
                Submit
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Requests list -->
      <v-col cols="12" md="8">
        <v-card elevation="3">
          <v-card-title class="pb-1">
            My Requests
          </v-card-title>
          <v-card-subtitle class="pb-3">
            Latest leave requests you have submitted.
          </v-card-subtitle>

          <v-card-text>
            <div v-if="loadingRequests" class="py-6 text-center">
              <v-progress-circular indeterminate size="32" />
            </div>

            <div v-else-if="!requests.length">
              <p class="empty-text">
                No leave requests yet. Submit your first request on the left.
              </p>
            </div>

            <div v-else class="table-wrap">
              <table class="leave-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in requests" :key="r._id">
                    <td>{{ r.leaveTypeCode }}</td>
                    <td>{{ fmtDate(r.startDate) }}</td>
                    <td>{{ fmtDate(r.endDate) }}</td>
                    <td>
                      <span class="status-pill" :class="'status-' + String(r.status || '').toLowerCase()">
                        {{ fmtStatus(r.status) }}
                      </span>
                    </td>
                    <td class="reason-cell">
                      {{ r.reason || '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="error" class="error-text mt-3">
              {{ error }}
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.page-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
}
.page-sub {
  margin: 4px 0 0;
  color: #4b5563;
  font-size: 0.95rem;
}
.page-meta {
  font-size: 0.85rem;
  color: #6b7280;
}
.meta-line {
  display: flex;
  align-items: center;
}

.summary-card {
  padding: 12px 16px;
}
.summary-label {
  font-size: 0.85rem;
  color: #6b7280;
}
.summary-value {
  font-size: 1.4rem;
  font-weight: 700;
  margin-top: 2px;
}

.form-card {
  height: 100%;
}

.table-wrap {
  width: 100%;
  overflow-x: auto;
}
.leave-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.leave-table th,
.leave-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}
.leave-table th {
  font-weight: 600;
  color: #4b5563;
  background: #f9fafb;
}
.reason-cell {
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.status-pending {
  background: #fef3c7;
  color: #92400e;
}
.status-approved {
  background: #dcfce7;
  color: #166534;
}
.status-rejected {
  background: #fee2e2;
  color: #b91c1c;
}
.status-cancelled {
  background: #e5e7eb;
  color: #374151;
}

.empty-text {
  color: #6b7280;
  font-size: 0.9rem;
}

.error-text {
  color: #b91c1c;
  font-size: 0.85rem;
}
</style>
