<!-- src/views/expat/MyRequests.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

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

// Expose reload() for parent (ExpatLeaveHome) to call
defineExpose({
  reload: fetchMyRequests,
})

onMounted(async () => {
  await fetchMyRequests()
})
</script>

<template>
  <v-card rounded="xl" elevation="3">
    <v-card-title class="d-flex align-center justify-space-between">
      <div>
        <div class="text-subtitle-1 font-weight-semibold">My Leave Requests</div>
        <div class="text-caption text-medium-emphasis">
          Latest requests are shown first.
        </div>
      </div>
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="loadingMyRequests"
        @click="fetchMyRequests"
      >
        Refresh
      </v-btn>
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
</template>

<style scoped>
.reason-cell {
  max-width: 260px;
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.text-subtitle-1 {
  letter-spacing: 0.01em;
}
</style>
