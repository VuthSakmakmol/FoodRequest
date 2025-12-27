<!-- src/views/expat/MyRequests.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'MyRequests' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── Identity for realtime ───────── */
/* Use computed so it updates when auth.user is ready/refreshed */
const employeeId = computed(() =>
  String(auth.user?.employeeId || localStorage.getItem('employeeId') || '').trim()
)
const loginId = computed(() =>
  String(auth.user?.id || localStorage.getItem('loginId') || '').trim()
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
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}
function statusLabel(s) {
  const key = String(s || '').toUpperCase()
  return STATUS_LABEL[key] || key || '—'
}
function statusBadgeClass(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'APPROVED')
    return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/40'
  if (st === 'REJECTED')
    return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/40'
  if (st === 'CANCELLED')
    return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800'
  if (st === 'PENDING_MANAGER' || st === 'PENDING_GM')
    return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/25 dark:text-amber-200 dark:border-amber-900/40'
  return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800'
}

/* ───────── COMPUTED ───────── */
const processedRequests = computed(() => {
  const items = [...myRequests.value]

  // newest first
  items.sort((a, b) => {
    const av = a.createdAt ? dayjs(a.createdAt).valueOf() : 0
    const bv = b.createdAt ? dayjs(b.createdAt).valueOf() : 0
    return bv - av
  })

  let result = items

  // status filter
  if (statusFilter.value !== 'ALL') {
    const st = String(statusFilter.value || '').toUpperCase()
    result = result.filter((r) => String(r.status || '').toUpperCase() === st)
  }

  // search
  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter((r) => {
      const code = String(r.leaveTypeCode || '').toLowerCase()
      const period = `${r.startDate || ''} ${r.endDate || ''}`.toLowerCase()
      const reason = String(r.reason || '').toLowerCase()
      const st = statusLabel(r.status || '').toLowerCase()
      return code.includes(q) || period.includes(q) || reason.includes(q) || st.includes(q)
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

watch([search, statusFilter, perPage], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchMyRequests(silent = false) {
  try {
    loadingMyRequests.value = true
    loadError.value = ''
    const res = await api.get('/leave/requests/my')
    myRequests.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchMyRequests error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load your leave requests.'
    if (!silent) {
      showToast({ type: 'error', title: 'Failed to load', message: loadError.value })
    }
  } finally {
    loadingMyRequests.value = false
  }
}

/* Expose reload() for parent */
defineExpose({ reload: fetchMyRequests })

/* ───────── Realtime helpers ───────── */
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const requester = String(payload.requesterLoginId || '').trim()

  const currentEmp = String(employeeId.value || '').trim()
  const currentLogin = String(loginId.value || '').trim()

  return (currentEmp && emp === currentEmp) || (currentLogin && requester === currentLogin)
}

/** Small debounce so multiple events only trigger one fetch */
let refreshTimer = null
function triggerRealtimeRefresh(reason = '') {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    // console.log('[MyRequests] realtime refresh:', reason)
    fetchMyRequests(true)
  }, 150)
}

const offHandlers = []
function setupRealtime() {
  // Join rooms for this employee + loginId so backend can target events
  if (employeeId.value) subscribeEmployeeIfNeeded(employeeId.value)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  offHandlers.push(
    // Created
    onSocket('leave:req:created', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh('created')
      showToast({ type: 'success', title: 'Request created', message: 'Your leave request was created successfully.' })
    }),

    // Manager decision
    onSocket('leave:req:manager-decision', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh('manager-decision')

      const st = String(payload.status || '').toUpperCase()
      if (st === 'PENDING_GM') {
        showToast({ type: 'success', title: 'Manager approved', message: 'Manager approved your leave and sent it to GM.' })
      } else if (st === 'REJECTED') {
        showToast({ type: 'error', title: 'Manager rejected', message: 'Manager rejected your leave request.' })
      }
    }),

    // GM decision
    onSocket('leave:req:gm-decision', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh('gm-decision')

      const st = String(payload.status || '').toUpperCase()
      if (st === 'APPROVED') {
        showToast({ type: 'success', title: 'GM approved', message: 'GM approved your leave request.' })
      } else if (st === 'REJECTED') {
        showToast({ type: 'error', title: 'GM rejected', message: 'GM rejected your leave request.' })
      }
    }),

    // Generic update (cancel, edit, etc.)
    onSocket('leave:req:updated', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh('updated')
    }),
  )
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchMyRequests(true)
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach((off) => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500 px-4 py-3 text-white">
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-sm font-semibold">My Leave Requests</p>
            <p class="text-[11px] text-sky-50/90">Track your submitted leave requests and their approval status.</p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Type, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <!-- Status filter -->
            <div class="min-w-[220px]">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Status</label>
              <select
                v-model="statusFilter"
                class="w-full rounded-xl border border-sky-100/80 bg-sky-900/25 px-2.5 py-2 text-[11px] text-white outline-none
                       focus:ring-2 focus:ring-white/40"
              >
                <option value="ALL">All</option>
                <option value="PENDING_MANAGER">Pending (Mgr)</option>
                <option value="PENDING_GM">Pending (GM)</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
              :disabled="loadingMyRequests"
              @click="fetchMyRequests()"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="loadingMyRequests ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat leave</p>
            <p class="text-sm font-semibold">My Leave Requests</p>
            <p class="text-[11px] text-sky-50/90">All your expat leave requests & status.</p>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25 px-2.5 py-1.5 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Type, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <div class="flex items-center gap-2">
              <select
                v-model="statusFilter"
                class="flex-1 rounded-xl border border-sky-100/80 bg-sky-900/25 px-2.5 py-2 text-[11px] text-white outline-none"
              >
                <option value="ALL">All</option>
                <option value="PENDING_MANAGER">Pending (Mgr)</option>
                <option value="PENDING_GM">Pending (GM)</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <button
                type="button"
                class="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                :disabled="loadingMyRequests"
                @click="fetchMyRequests()"
                title="Refresh"
              >
                <i class="fa-solid fa-rotate text-[11px]" :class="loadingMyRequests ? 'fa-spin' : ''" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading skeleton -->
        <div v-if="loadingMyRequests && !processedRequests.length" class="space-y-2">
          <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div v-for="i in 3" :key="'sk-' + i" class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
        </div>

        <!-- Content -->
        <div v-else>
          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedRequests.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
              You have not submitted any leave requests yet.
            </p>

            <article
              v-for="item in pagedRequests"
              :key="item._id"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700
                             border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80"
                    >
                      {{ item.leaveTypeCode || '—' }}
                    </span>
                    <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="statusBadgeClass(item.status)">
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

              <div class="mt-2 h-px bg-slate-200 dark:bg-slate-800" />

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-200">
                <span class="font-medium">Reason:</span>
                <span class="ml-1">{{ item.reason || '—' }}</span>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div v-else class="overflow-x-auto">
            <table class="min-w-[900px] w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
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
                <tr v-if="!pagedRequests.length">
                  <td colspan="6" class="px-3 py-6 text-center text-[12px] text-slate-500 border-t border-slate-200 dark:border-slate-700 dark:text-slate-400">
                    You have not submitted any leave requests yet.
                  </td>
                </tr>

                <tr
                  v-for="item in pagedRequests"
                  :key="item._id"
                  class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td whitespace-nowrap">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-100
                             dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80"
                    >
                      {{ item.leaveTypeCode || '—' }}
                    </span>
                  </td>

                  <td class="table-td whitespace-nowrap font-mono">
                    {{ item.startDate }} → {{ item.endDate }}
                  </td>

                  <td class="table-td text-right font-semibold tabular-nums">
                    {{ Number(item.totalDays || 0).toLocaleString() }}
                  </td>

                  <td class="table-td">
                    <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" :class="statusBadgeClass(item.status)">
                      {{ statusLabel(item.status) }}
                    </span>
                  </td>

                  <td class="table-td">
                    <span class="block max-w-[520px] truncate text-xs sm:text-[13px]">
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
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select v-model="perPage" class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-900">
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <span class="px-2">Page {{ page }} / {{ pageCount }}</span>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 800; white-space: nowrap; }
.table-td { padding: 10px 10px; vertical-align: top; }

.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination-btn:not(:disabled):hover { background: #e5edff; }
.dark .pagination-btn { background: #020617; color: #e5e7eb; border-color: rgba(148, 163, 184, 0.9); }
.dark .pagination-btn:not(:disabled):hover { background: #1e293b; }
</style>
