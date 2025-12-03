<!-- src/views/expat/ManagerLeaveInbox.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import Swal from 'sweetalert2'

const loading   = ref(false)
const rows      = ref([])
const search    = ref('')
const statusTab = ref('PENDING_MANAGER') // future-proof if you want more

const headers = [
  { title: 'Requested At', key: 'createdAt',    width: 140 },
  { title: 'Employee ID',  key: 'employeeId',   width: 110 },
  { title: 'Type',         key: 'leaveTypeCode', width: 80 },
  { title: 'Date Range',   key: 'range',        minWidth: 150 },
  { title: 'Days',         key: 'totalDays',    width: 70, align: 'end' },
  { title: 'Reason',       key: 'reason',       minWidth: 220 },
  { title: 'Status',       key: 'status',       width: 120, align: 'center' },
  { title: 'Actions',      key: 'actions',      width: 160, align: 'end' },
]

function formatRange(row) {
  const s = row.startDate || ''
  const e = row.endDate || ''
  if (!s && !e) return '—'
  if (s === e) return s
  return `${s} → ${e}`
}

function statusColor(status) {
  switch (status) {
    case 'PENDING_MANAGER':
      return 'amber'
    case 'PENDING_GM':
      return 'indigo'
    case 'APPROVED':
      return 'green'
    case 'REJECTED':
      return 'red'
    case 'CANCELLED':
    default:
      return 'grey'
  }
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = rows.value

  if (statusTab.value) {
    list = list.filter(r => r.status === statusTab.value)
  }

  if (q) {
    list = list.filter(r =>
      (r.employeeId || '').toLowerCase().includes(q) ||
      (r.leaveTypeCode || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q)
    )
  }

  return list
})

async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/manager/inbox')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchInbox error', e)
  } finally {
    loading.value = false
  }
}

async function decide(row, action) {
  const isApprove = action === 'APPROVE'

  const { value: comment, isConfirmed } = await Swal.fire({
    title: isApprove ? 'Approve this request?' : 'Reject this request?',
    input: 'textarea',
    inputLabel: 'Comment (optional)',
    inputPlaceholder: 'Add any note for employee…',
    inputAttributes: { 'aria-label': 'Comment' },
    showCancelButton: true,
    confirmButtonText: isApprove ? 'Approve' : 'Reject',
    confirmButtonColor: isApprove ? '#16a34a' : '#dc2626',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
  })

  if (!isConfirmed) return

  try {
    await api.post(`/leave/requests/${row._id}/manager-decision`, {
      action,
      comment: comment || '',
    })
    await Swal.fire({
      icon: 'success',
      title: isApprove ? 'Approved' : 'Rejected',
      timer: 900,
      showConfirmButton: false,
    })
    await fetchInbox()
  } catch (e) {
    console.error('managerDecision error', e)
    await Swal.fire({
      icon: 'error',
      title: 'Failed',
      text: e?.response?.data?.message || 'Unable to update request.',
    })
  }
}

onMounted(fetchInbox)
</script>

<template>
  <v-container fluid class="pa-4">
    <!-- Title + filters -->
    <v-row>
      <v-col cols="12" class="d-flex flex-column flex-md-row align-md-center justify-md-space-between">
        <div class="mb-3 mb-md-0">
          <h1 class="text-h5 font-weight-bold mb-1">
            Manager Inbox
          </h1>
          <p class="text-body-2 text-medium-emphasis">
            Review and approve expatriate leave requests assigned to you.
          </p>
        </div>

        <div class="d-flex flex-column flex-sm-row align-sm-center gap-2">
          <v-text-field
            v-model="search"
            placeholder="Search by employee / type / reason..."
            density="compact"
            variant="outlined"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            style="min-width: 260px;"
          />

          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-refresh"
            class="mt-2 mt-sm-0"
            :loading="loading"
            @click="fetchInbox"
          >
            Refresh
          </v-btn>
        </div>
      </v-col>
    </v-row>

    <!-- Tabs (future-proof, even if only PENDING_MANAGER for now) -->
    <v-row>
      <v-col cols="12">
        <v-tabs
          v-model="statusTab"
          density="comfortable"
          class="mb-2"
        >
          <v-tab value="PENDING_MANAGER">Pending (Manager)</v-tab>
          <v-tab value="PENDING_GM">Already sent to GM</v-tab>
        </v-tabs>
      </v-col>
    </v-row>

    <!-- Table -->
    <v-row>
      <v-col cols="12">
        <v-card rounded="xl" elevation="3">
          <v-card-text class="pa-0">
            <v-data-table
              :headers="headers"
              :items="filteredRows"
              :loading="loading"
              density="compact"
              class="manager-leave-table"
              hover
              hide-default-footer
            >
              <template #item.createdAt="{ item }">
                {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
              </template>

              <template #item.leaveTypeCode="{ item }">
                <v-chip size="small" color="primary" variant="flat">
                  {{ item.leaveTypeCode }}
                </v-chip>
              </template>

              <template #item.range="{ item }">
                {{ formatRange(item) }}
              </template>

              <template #item.totalDays="{ item }">
                {{ Number(item.totalDays || 0).toLocaleString() }}
              </template>

              <template #item.reason="{ item }">
                <span class="text-truncate-2">
                  {{ item.reason || '—' }}
                </span>
              </template>

              <template #item.status="{ item }">
                <v-chip
                  size="x-small"
                  :color="statusColor(item.status)"
                  variant="flat"
                >
                  {{ item.status }}
                </v-chip>
              </template>

              <template #item.actions="{ item }">
                <template v-if="item.status === 'PENDING_MANAGER'">
                  <v-btn
                    size="small"
                    color="green"
                    variant="tonal"
                    class="mr-1"
                    prepend-icon="mdi-check"
                    @click="decide(item, 'APPROVE')"
                  >
                    Approve
                  </v-btn>
                  <v-btn
                    size="small"
                    color="red"
                    variant="text"
                    prepend-icon="mdi-close"
                    @click="decide(item, 'REJECT')"
                  >
                    Reject
                  </v-btn>
                </template>
                <span v-else class="text-caption text-medium-emphasis">
                  No action
                </span>
              </template>

              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading manager inbox...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  No leave requests in your queue.
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
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* small helper for flex gaps */
.gap-2 > * + * {
  margin-left: 0.5rem;
}

.manager-leave-table :deep(table) {
  min-width: 900px;
}
@media (max-width: 960px) {
  .manager-leave-table :deep(table) {
    min-width: 100%;
  }
}
</style>
