<!-- src/views/expat/AdminExpatYearSheet.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'

const route = useRoute()

const loading = ref(false)
const error   = ref('')
const sheet   = ref(null) // { employee, period, totals, requests }

/* ─────────────────────────────
 *  Status → chip color
 * ───────────────────────────── */
const STATUS_COLOR = {
  PENDING_MANAGER: 'amber',
  PENDING_GM:      'blue',
  APPROVED:        'green',
  REJECTED:        'red',
  CANCELLED:       'grey',
}
const statusColor = s => STATUS_COLOR[s] || 'grey'

/* ─────────────────────────────
 *  Load from backend
 * ───────────────────────────── */
const employeeId = computed(() => route.params.employeeId)

async function fetchYearSheet() {
  if (!employeeId.value) return
  loading.value = true
  error.value   = ''

  try {
    const res = await api.get(
      `/admin/leave/profiles/${employeeId.value}/year-sheet`
    )
    sheet.value = res.data || null
  } catch (e) {
    console.error('fetchYearSheet error', e)
    error.value = e?.response?.data?.message || 'Failed to load year sheet.'
  } finally {
    loading.value = false
  }
}

/* ─────────────────────────────
 *  Table rows (1 row per request)
 * ───────────────────────────── */
const rows = computed(() => {
  if (!sheet.value) return []
  const reqs = sheet.value.requests || []

  return reqs.map((r, index) => {
    const days =
      r.totalDays ||
      (r.startDate && r.endDate
        ? dayjs(r.endDate).diff(dayjs(r.startDate), 'day') + 1
        : 0)

    const base = {
      no: index + 1,
      from: r.startDate ? dayjs(r.startDate).format('YYYY-MM-DD') : '',
      to:   r.endDate   ? dayjs(r.endDate).format('YYYY-MM-DD')   : '',
      days,
      AL: 0,
      UL: 0,
      SP: 0,
      MC: 0,
      MA: 0,
      requestBy: r.employeeName || sheet.value.employee?.name || '',
      supervisor: r.managerLoginId || '',
      gm: r.gmLoginId || '',
      remark: r.reason || '',
      status: r.status,
    }

    // put days into the correct leave-type column
    if (['AL', 'UL', 'SP', 'MC', 'MA'].includes(r.leaveTypeCode)) {
      base[r.leaveTypeCode] = days
    }

    return base
  })
})

/* ─────────────────────────────
 *  Vuetify headers
 * ───────────────────────────── */
const headers = [
  { title: 'No',            key: 'no',        width: 60,  align: 'center' },
  { title: 'From',          key: 'from',      width: 110 },
  { title: 'To',            key: 'to',        width: 110 },
  { title: 'Day(s)',        key: 'days',      width: 80,  align: 'end' },
  { title: 'Annual (AL)',   key: 'AL',        width: 110, align: 'end' },
  { title: 'Unpaid (UL)',   key: 'UL',        width: 110, align: 'end' },
  { title: 'Special (SP)',  key: 'SP',        width: 110, align: 'end' },
  { title: 'Sick (MC)',     key: 'MC',        width: 110, align: 'end' },
  { title: 'Maternity (MA)',key: 'MA',        width: 140, align: 'end' },
  { title: 'Request By',    key: 'requestBy', minWidth: 160 },
  { title: 'Supervisor',    key: 'supervisor',minWidth: 140 },
  { title: 'GM',            key: 'gm',        minWidth: 140 },
  { title: 'Remark',        key: 'remark',    minWidth: 200 },
  { title: 'Status',        key: 'status',    width: 110 },
]

/* ─────────────────────────────
 *  Totals helper (if needed later)
 * ───────────────────────────── */
const summaryByCode = computed(() => {
  const map = {}
  if (!sheet.value) return map
  for (const t of sheet.value.totals || []) {
    map[t.code] = t
  }
  return map
})

onMounted(fetchYearSheet)
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12">
        <h1 class="text-h5 font-weight-bold mb-1">
          Expat Leave Year Sheet
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-2">
          One-year leave history and balance based on the employee's join date.
        </p>
      </v-col>
    </v-row>

    <!-- MAIN CONTENT -->
    <v-row v-if="sheet">
      <!-- LEFT : employee + balances -->
      <v-col cols="12" md="4">
        <v-card rounded="xl" elevation="3" class="mb-4">
          <v-card-title class="text-subtitle-1 font-weight-semibold pb-1">
            Employee
          </v-card-title>
          <v-card-text class="text-body-2">
            <div><strong>ID:</strong> {{ sheet.employee.employeeId }}</div>
            <div><strong>Name:</strong> {{ sheet.employee.name }}</div>
            <div><strong>Dept:</strong> {{ sheet.employee.department || '—' }}</div>
            <div><strong>Contact:</strong> {{ sheet.employee.contactNumber || '—' }}</div>
            <v-divider class="my-3" />
            <div><strong>Service Year:</strong></div>
            <div>{{ sheet.period.startDate }} → {{ sheet.period.endDate }}</div>
          </v-card-text>
        </v-card>

        <v-card rounded="xl" elevation="2">
          <v-card-title class="text-subtitle-1 font-weight-semibold pb-1">
            Balances (current year)
          </v-card-title>
          <v-card-text>
            <v-row dense>
              <v-col
                v-for="t in sheet.totals"
                :key="t.code"
                cols="12"
                sm="6"
                class="pb-2"
              >
                <div class="text-caption font-weight-medium">
                  {{ t.code }} – {{ t.name }}
                </div>
                <div class="text-body-2">
                  Used: {{ t.usedApproved }} /
                  Entitle: {{ t.entitlement }} ·
                  Remain: <strong>{{ t.remaining }}</strong>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- RIGHT : year records -->
      <v-col cols="12" md="8">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">
                Leave Records (current service year)
              </div>
              <div class="text-caption text-medium-emphasis">
                One row per request. Columns split by leave type.
              </div>
            </div>
          </v-card-title>

          <v-divider />

          <v-card-text class="pa-0">
            <v-data-table
              :headers="headers"
              :items="rows"
              :loading="loading"
              density="compact"
            >
              <template #item.status="{ item }">
                <v-chip
                  size="small"
                  :color="statusColor(item.status)"
                  variant="flat"
                >
                  {{ item.status }}
                </v-chip>
              </template>

              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading year sheet...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  No leave requests in this service year.
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- NO SHEET -->
    <v-row v-else-if="!loading">
      <v-col cols="12">
        <v-alert type="info" variant="tonal">
          No data available.
        </v-alert>
      </v-col>
    </v-row>

    <!-- ERROR -->
    <v-row v-if="error">
      <v-col cols="12">
        <v-alert type="error" variant="tonal" class="mt-3">
          {{ error }}
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.text-subtitle-1 {
  letter-spacing: 0.01em;
}
</style>
