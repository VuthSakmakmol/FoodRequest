<!-- src/views/expat/ExpatLeaveHome.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

/* ─────────────────────────────
 *  LEAVE TYPES (from ADMIN only)
 * ───────────────────────────── */

const loadingTypes = ref(false)
const leaveTypes   = ref([])
const typesError   = ref('')

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''

    // 🔁 CHANGED: from '/admin/leave/types' to '/leave/types'
    const res = await api.get('/leave/types')
    const data = Array.isArray(res.data) ? res.data : []
    leaveTypes.value = data

    if (!data.length) {
      typesError.value = 'No leave types configured yet. Please contact admin.'
    }
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    typesError.value =
      e?.response?.data?.message ||
      'Unable to load leave types. Please contact admin.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}


/* ─────────────────────────────
 *  NEW LEAVE REQUEST FORM
 * ───────────────────────────── */

const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',
})

const submitting   = ref(false)
const formError    = ref('')
const formSuccess  = ref('')

const canSubmit = computed(() =>
  !!form.value.leaveTypeCode &&
  !!form.value.startDate &&
  !!form.value.endDate &&
  !submitting.value
)

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    reason: '',
  }
  formError.value = ''
  formSuccess.value = ''
}

async function submitRequest() {
  if (!canSubmit.value) return

  formError.value = ''
  formSuccess.value = ''
  submitting.value = true

  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      reason: form.value.reason || '',
    }

    await api.post('/leave/requests', payload)

    formSuccess.value = 'Leave request submitted successfully.'
    resetForm()
    await fetchMyRequests()
  } catch (e) {
    console.error('submitRequest error', e)
    formError.value = e?.response?.data?.message || 'Failed to submit leave request.'
  } finally {
    submitting.value = false
  }
}

/* ─────────────────────────────
 *  MY REQUESTS TABLE
 * ───────────────────────────── */

const loadingMyRequests = ref(false)
const myRequests        = ref([])

const headers = [
  { title: 'Created',   key: 'createdAt',     width: 120 },
  { title: 'Type',      key: 'leaveTypeCode', width: 90 },
  { title: 'Period',    key: 'period',        minWidth: 160 },
  { title: 'Days',      key: 'totalDays',     width: 70, align: 'end' },
  { title: 'Status',    key: 'status',        width: 130 },
  { title: 'Reason',    key: 'reason',        minWidth: 200 },
]

const STATUS_LABEL = {
  PENDING_MANAGER: 'Pending Manager',
  PENDING_GM:      'Pending GM',
  APPROVED:        'Approved',
  REJECTED:        'Rejected',
  CANCELLED:       'Cancelled',
}

const STATUS_COLOR = {
  PENDING_MANAGER: 'amber',
  PENDING_GM:      'blue',
  APPROVED:        'green',
  REJECTED:        'red',
  CANCELLED:       'grey',
}

function statusLabel(s) {
  return STATUS_LABEL[s] || s
}
function statusColor(s) {
  return STATUS_COLOR[s] || 'grey'
}

async function fetchMyRequests() {
  try {
    loadingMyRequests.value = true
    const res = await api.get('/leave/requests/my')
    myRequests.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchMyRequests error', e)
  } finally {
    loadingMyRequests.value = false
  }
}

/* ─────────────────────────────
 *  INIT
 * ───────────────────────────── */

onMounted(async () => {
  await fetchLeaveTypes()
  await fetchMyRequests()
})
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12">
        <h1 class="text-h5 font-weight-bold mb-1">
          Expat Leave
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Submit new leave requests and track your approval status.
        </p>
      </v-col>
    </v-row>

    <v-row>
      <!-- LEFT: New request form -->
      <v-col cols="12" md="4">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="text-subtitle-1 font-weight-semibold pb-1">
            Request New Leave
          </v-card-title>

          <v-card-subtitle class="text-caption text-medium-emphasis pb-0">
            Choose leave type and date range, then submit for approval.
          </v-card-subtitle>

          <v-card-text>
            <v-form @submit.prevent="submitRequest">
              <v-select
                v-model="form.leaveTypeCode"
                :items="leaveTypes"
                :loading="loadingTypes"
                item-title="name"
                item-value="code"
                label="Leave Type"
                density="compact"
                variant="outlined"
                class="mb-2"
                :disabled="loadingTypes || !leaveTypes.length"
                :hint="typesError || ''"
                :persistent-hint="!!typesError"
              />

              <v-text-field
                v-model="form.startDate"
                label="Start Date"
                type="date"
                density="compact"
                variant="outlined"
                class="mb-3"
              />

              <v-text-field
                v-model="form.endDate"
                label="End Date"
                type="date"
                density="compact"
                variant="outlined"
                class="mb-3"
              />

              <v-textarea
                v-model="form.reason"
                label="Reason (optional)"
                rows="2"
                auto-grow
                density="compact"
                variant="outlined"
                class="mb-2"
              />

              <div v-if="formError" class="text-caption text-error mb-2">
                {{ formError }}
              </div>
              <div v-if="formSuccess" class="text-caption text-success mb-2">
                {{ formSuccess }}
              </div>

              <div class="d-flex justify-end mt-2">
                <v-btn
                  variant="text"
                  class="mr-2"
                  @click="resetForm"
                  :disabled="submitting"
                >
                  Reset
                </v-btn>
                <v-btn
                  color="primary"
                  variant="flat"
                  :loading="submitting"
                  :disabled="!canSubmit || !leaveTypes.length"
                  @click="submitRequest"
                >
                  Submit
                </v-btn>
              </div>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- RIGHT: My requests -->
      <v-col cols="12" md="8">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">My Leave Requests</div>
              <div class="text-caption text-medium-emphasis">
                Latest requests are shown first.
              </div>
            </div>
          </v-card-title>

          <v-divider />

          <v-card-text class="pa-0">
            <v-data-table
              :headers="headers"
              :items="myRequests"
              :loading="loadingMyRequests"
              density="compact"
            >
              <template #item.createdAt="{ item }">
                {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD') : '—' }}
              </template>

              <template #item.period="{ item }">
                <span>
                  {{ item.startDate }} → {{ item.endDate }}
                </span>
              </template>

              <template #item.status="{ item }">
                <v-chip
                  size="small"
                  :color="statusColor(item.status)"
                  variant="flat"
                >
                  {{ statusLabel(item.status) }}
                </v-chip>
              </template>

              <template #item.reason="{ item }">
                <span class="text-truncate reason-cell">
                  {{ item.reason || '—' }}
                </span>
              </template>

              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading your leave requests...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  You have not submitted any leave requests yet.
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.reason-cell {
  max-width: 260px;
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.text-success {
  color: #16a34a;
}
.text-subtitle-1 {
  letter-spacing: 0.01em;
}
</style>
