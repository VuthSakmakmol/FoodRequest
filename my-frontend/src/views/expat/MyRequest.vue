<!-- src/views/expat/MyRequests.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

const { showToast } = useToast()
const auth = useAuth()

/* ───────── Identity for realtime ───────── */
/* Use computed so it updates when auth.user is ready/refreshed */
const employeeId = computed(() =>
  String(auth.user?.employeeId || localStorage.getItem('employeeId') || '')
)
const loginId = computed(() =>
  String(auth.user?.id || localStorage.getItem('loginId') || '')
)

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loadingMyRequests = ref(false)
const loadError = ref('')
const myRequests = ref([])

const search = ref('')
const statusFilter = ref('ALL') // ALL | PENDING_MANAGER | PENDING_GM | APPROVED | REJECTED | CANCELLED

// pagination
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

const STATUS_LABEL = {
  PENDING_MANAGER: 'Pending Manager',
  PENDING_GM: 'Pending GM',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled'
}
const STATUS_COLOR = {
  PENDING_MANAGER: 'amber',
  PENDING_GM: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'grey'
}

function statusLabel(s) {
  return STATUS_LABEL[s] || s
}
function statusColorClass(s) {
  switch (STATUS_COLOR[s]) {
    case 'amber':
      return 'bg-amber-100 text-amber-700 border border-amber-200'
    case 'blue':
      return 'bg-sky-100 text-sky-700 border border-sky-200'
    case 'green':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200'
    case 'red':
      return 'bg-rose-100 text-rose-700 border border-rose-200'
    case 'grey':
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200'
  }
}

/* ───────── COMPUTED ───────── */

const processedRequests = computed(() => {
  const items = [...myRequests.value]

  items.sort((a, b) => {
    const av = a.createdAt ? dayjs(a.createdAt).valueOf() : 0
    const bv = b.createdAt ? dayjs(b.createdAt).valueOf() : 0
    return bv - av
  })

  let result = items

  if (statusFilter.value !== 'ALL') {
    result = result.filter(r => r.status === statusFilter.value)
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter(r => {
      const code = String(r.leaveTypeCode || '').toLowerCase()
      const period = `${r.startDate || ''} ${r.endDate || ''}`.toLowerCase()
      const reason = String(r.reason || '').toLowerCase()
      const status = statusLabel(r.status || '').toLowerCase()
      return (
        code.includes(q) ||
        period.includes(q) ||
        reason.includes(q) ||
        status.includes(q)
      )
    })
  }

  return result
})

const pagedRequests = computed(() => {
  if (perPage.value === 'All') return processedRequests.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRequests.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRequests.value.length / per) || 1
})

watch([search, statusFilter], () => {
  page.value = 1
})

/* ───────── API ───────── */

async function fetchMyRequests() {
  try {
    loadingMyRequests.value = true
    loadError.value = ''
    const res = await api.get('/leave/requests/my')
    myRequests.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchMyRequests error', e)
    loadError.value =
      e?.response?.data?.message || 'Unable to load your leave requests.'
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: loadError.value
    })
  } finally {
    loadingMyRequests.value = false
  }
}

/* Expose reload() for parent */
defineExpose({
  reload: fetchMyRequests
})

/* ───────── Realtime helpers ───────── */

/** Decide if this payload belongs to this expat/user */
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '')
  const requester = String(payload.requesterLoginId || '')

  const currentEmp = String(employeeId.value || '')
  const currentLogin = String(loginId.value || '')

  return (
    (currentEmp && emp === currentEmp) ||
    (currentLogin && requester === currentLogin)
  )
}

/** Small debounce so multiple events only trigger one fetch */
let refreshTimer = null
function triggerRealtimeRefresh(reason = '') {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    // console.log('[MyRequests] realtime refresh:', reason)
    fetchMyRequests()
  }, 150)
}

const offHandlers = []

function setupRealtime() {
  // Join rooms for this employee + loginId so backend can target events
  if (employeeId.value) {
    subscribeEmployeeIfNeeded(employeeId.value)
  }
  if (loginId.value) {
    subscribeUserIfNeeded(loginId.value)
  }

  // Created by me (or for my employeeId)
  const offCreated = onSocket('leave:req:created', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('created')

    showToast({
      type: 'success',
      title: 'Request created',
      message: 'Your leave request was created successfully.'
    })
  })

  // Manager decision
  const offManager = onSocket('leave:req:manager-decision', (payload = {}) => {
    if (!isMyDoc(payload)) return

    triggerRealtimeRefresh('manager-decision')

    const status = String(payload.status || '')
    if (status === 'PENDING_GM') {
      showToast({
        type: 'success',
        title: 'Manager approved',
        message: 'Manager approved your leave and sent it to GM.'
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'Manager rejected',
        message: 'Manager rejected your leave request.'
      })
    }
  })

  // GM decision
  const offGm = onSocket('leave:req:gm-decision', (payload = {}) => {
    if (!isMyDoc(payload)) return

    triggerRealtimeRefresh('gm-decision')

    const status = String(payload.status || '')
    if (status === 'APPROVED') {
      showToast({
        type: 'success',
        title: 'GM approved',
        message: 'GM approved your leave request.'
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'GM rejected',
        message: 'GM rejected your leave request.'
      })
    }
  })

  // Generic updates (cancel, edit, etc.)
  const offUpdated = onSocket('leave:req:updated', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('updated')
  })

  offHandlers.push(offCreated, offManager, offGm, offUpdated)
}

/* ───────── lifecycle ───────── */

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }

  await fetchMyRequests()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }
  offHandlers.forEach(off => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Gradient header -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500
               px-4 py-3 text-white"
      >
        <!-- Desktop header / filters -->
        <div
          v-if="!isMobile"
          class="flex flex-wrap items-end justify-between gap-4"
        >
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">
              Expat Holiday
            </p>
            <p class="text-sm font-semibold">
              My Leave Requests
            </p>
            <p class="text-[11px] text-sky-50/90">
              Track your submitted holiday requests and their approval status.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">
                Search
              </label>
              <div
                class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25
                       px-2.5 py-1.5 text-xs"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Type, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <!-- Status filter -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="mr-1 text-sky-50/80">Status</span>
              <div class="flex rounded-full bg-sky-900/20 p-0.5">
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'ALL'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'ALL'"
                >
                  All
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'PENDING_MANAGER'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'PENDING_MANAGER'"
                >
                  Manager
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'PENDING_GM'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'PENDING_GM'"
                >
                  GM
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'APPROVED'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'APPROVED'"
                >
                  Approved
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile header / filters -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">
              Expat Holiday
            </p>
            <p class="text-sm font-semibold">
              My Leave Requests
            </p>
            <p class="text-[11px] text-sky-50/90">
              All your expat holiday requests & status.
            </p>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">
                Search
              </label>
              <div
                class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25
                       px-2.5 py-1.5 text-[11px]"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Type, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div class="flex items-center gap-1">
                <span class="text-sky-50/80">Status</span>
                <div class="flex rounded-full bg-sky-900/20 p-0.5">
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'ALL'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'ALL'"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'PENDING_MANAGER'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'PENDING_MANAGER'"
                  >
                    Manager
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'PENDING_GM'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'PENDING_GM'"
                  >
                    GM
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'APPROVED'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'APPROVED'"
                  >
                    Approved
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error banner -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading skeleton -->
        <div v-if="loadingMyRequests && !processedRequests.length" class="space-y-2">
          <div
            class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"
          ></div>
          <div
            v-for="i in 3"
            :key="'sk-' + i"
            class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"
          ></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE: cards -->
          <div v-if="isMobile" class="space-y-2">
            <p
              v-if="!pagedRequests.length"
              class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            >
              You have not submitted any leave requests yet.
            </p>

            <article
              v-for="item in pagedRequests"
              :key="item._id"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5
                             text-[11px] font-semibold text-sky-700
                             border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80"
                    >
                      {{ item.leaveTypeCode || '—' }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                      :class="statusColorClass(item.status)"
                    >
                      {{ statusLabel(item.status) }}
                    </span>
                  </div>
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ item.startDate }} → {{ item.endDate }}
                  </div>
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Requested:
                    <span class="font-medium text-slate-800 dark:text-slate-100">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD') : '—' }}
                    </span>
                  </div>
                </div>

                <div class="text-right text-[11px] text-slate-600 dark:text-slate-300">
                  <div>
                    Days:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ Number(item.totalDays || 0).toLocaleString() }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-2 border-t border-slate-200 pt-1 dark:border-slate-700" />

              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-200">
                <span class="font-medium">Reason:</span>
                <span> {{ item.reason || '—' }} </span>
              </div>
            </article>
          </div>

          <!-- DESKTOP: table -->
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-[720px] w-full text-left text-xs sm:text-[13px]
                     text-slate-700 dark:text-slate-100"
            >
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Created</th>
                  <th class="table-th">Type</th>
                  <th class="table-th">Period</th>
                  <th class="table-th text-right">Days</th>
                  <th class="table-th">Status</th>
                  <th class="table-th">Reason</th>
                </tr>
              </thead>
              <tbody>
                <!-- No data -->
                <tr v-if="!pagedRequests.length">
                  <td
                    colspan="6"
                    class="px-3 py-6 text-center text-[12px] text-slate-500
                           border-t border-slate-200
                           dark:border-slate-700 dark:text-slate-400"
                  >
                    You have not submitted any leave requests yet.
                  </td>
                </tr>

                <!-- Rows -->
                <tr
                  v-for="item in pagedRequests"
                  :key="item._id"
                  class="border-b border-slate-200 text-[12px]
                         hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td whitespace-nowrap">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD') : '—' }}
                  </td>

                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700
                             border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80"
                    >
                      {{ item.leaveTypeCode || '—' }}
                    </span>
                  </td>

                  <td class="table-td whitespace-nowrap">
                    {{ item.startDate }} → {{ item.endDate }}
                  </td>

                  <td class="table-td text-right">
                    {{ Number(item.totalDays || 0).toLocaleString() }}
                  </td>

                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      :class="statusColorClass(item.status)"
                    >
                      {{ statusLabel(item.status) }}
                    </span>
                  </td>

                  <td class="table-td">
                    <span
                      class="block max-w-xs truncate text-xs sm:text-[13px] text-slate-700 dark:text-slate-100"
                    >
                      {{ item.reason || '—' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            v-if="processedRequests.length"
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2
                   text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300
                   sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="perPage"
                class="rounded-lg border border-slate-300 bg-white px-2 py-1
                       text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option
                  v-for="opt in perPageOptions"
                  :key="'per-' + opt"
                  :value="opt"
                >
                  {{ opt }}
                </option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = 1"
              >
                «
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = Math.max(1, page - 1)"
              >
                Prev
              </button>
              <span class="px-2">
                Page {{ page }} / {{ pageCount }}
              </span>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = Math.min(pageCount, page + 1)"
              >
                Next
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = pageCount"
              >
                »
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
}
.table-td {
  padding: 8px 10px;
  vertical-align: top;
}

/* Pagination (same standard) */
.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination-btn:not(:disabled):hover {
  background: #e5edff;
}
.dark .pagination-btn {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.9);
  color: #e5e7eb;
}
.dark .pagination-btn:not(:disabled):hover {
  background: #1e293b;
}
</style>
