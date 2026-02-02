<!-- src/views/expat/ManagerLeaveInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'ManagerLeaveInbox' })

const router = useRouter()
const { showToast } = useToast()
const auth = useAuth()

/* ✅ roles helper (supports user.role + user.roles[]) */
const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const base = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').trim()))]
})

/* ✅ Manager decide check */
const canManagerDecide = computed(() => roles.value.includes('LEAVE_MANAGER'))

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusTab = ref('PENDING_MANAGER') // 'PENDING_MANAGER' | 'PENDING_GM'

/* ✅ Filters (default ALL) */
const fromDate = ref('') // Requested at (createdAt)
const toDate = ref('')   // Requested at (createdAt)
const employeeFilter = ref('')

/* Pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

/* ✅ Display leave date range in DD-MM-YYYY (not a filter) */
function formatRange(row) {
  const s = row.startDate ? dayjs(row.startDate).format('DD-MM-YYYY') : ''
  const e = row.endDate ? dayjs(row.endDate).format('DD-MM-YYYY') : ''
  if (!s && !e) return '—'
  if (s === e) return s
  return `${s} → ${e}`
}

function statusChipClasses(status) {
  switch (status) {
    case 'PENDING_MANAGER':
      return 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/80'
    case 'PENDING_GM':
      return 'bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700/80'
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700/80'
    case 'REJECTED':
      return 'bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/80'
    case 'CANCELLED':
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700/80'
  }
}

function statusWeight(s) {
  switch (s) {
    case 'PENDING_MANAGER': return 0
    case 'PENDING_GM':      return 1
    case 'APPROVED':        return 2
    case 'REJECTED':        return 3
    case 'CANCELLED':       return 4
    default:                return 99
  }
}

/* ✅ Go to Profile page and auto-select that expat */
function goProfile(row) {
  const empId = String(row?.employeeId || '').trim()
  if (!empId) return
  router.push({ name: 'leave-manager-profile', query: { employeeId: empId } })
}

/* quick tools */
function clearFilters() {
  search.value = ''
  employeeFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  statusTab.value = 'PENDING_MANAGER'
}

async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/manager/inbox')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchInbox error', e)
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: e?.response?.data?.message || 'Unable to load manager inbox.',
    })
  } finally {
    loading.value = false
  }
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const empQ = employeeFilter.value.trim().toLowerCase()

  let list = [...rows.value]

  if (empQ) {
    list = list.filter(r => String(r.employeeId || '').toLowerCase().includes(empQ))
  }

  if (q) {
    list = list.filter(r =>
      String(r.employeeId || '').toLowerCase().includes(q) ||
      String(r.employeeName || '').toLowerCase().includes(q) ||
      String(r.leaveTypeCode || '').toLowerCase().includes(q) ||
      String(r.reason || '').toLowerCase().includes(q)
    )
  }

  // Tab filter
  if (statusTab.value === 'PENDING_GM') {
    list = list.filter(r => ['PENDING_GM', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status))
  }

  // ✅ Date filter by REQUEST DATE (createdAt)
  const fromVal = fromDate.value ? dayjs(fromDate.value).startOf('day').valueOf() : null
  const toVal   = toDate.value   ? dayjs(toDate.value).endOf('day').valueOf()   : null

  if (fromVal !== null || toVal !== null) {
    list = list.filter(r => {
      if (!r.createdAt) return false
      const t = dayjs(r.createdAt).valueOf()
      if (fromVal !== null && t < fromVal) return false
      if (toVal !== null && t > toVal) return false
      return true
    })
  }

  // Sort by status priority, then created desc
  list.sort((a, b) => {
    const sw = statusWeight(a.status) - statusWeight(b.status)
    if (sw !== 0) return sw
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  })

  return list
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return filteredRows.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return filteredRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(filteredRows.value.length / per) || 1
})

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

watch(
  () => [search.value, statusTab.value, fromDate.value, toDate.value, employeeFilter.value, perPage.value],
  () => { page.value = 1 }
)

/* ───────── Confirm dialog ───────── */
const confirmDialog = ref({
  open: false,
  action: 'APPROVE', // 'APPROVE' | 'REJECT'
  row: null,
  comment: ''
})

function openDecisionDialog(row, action) {
  if (!canManagerDecide.value) {
    showToast({
      type: 'error',
      title: 'Not allowed',
      message: 'You do not have permission to approve or reject as Manager.',
    })
    return
  }
  confirmDialog.value.open = true
  confirmDialog.value.row = row
  confirmDialog.value.action = action
  confirmDialog.value.comment = ''
}

function closeDecisionDialog() {
  confirmDialog.value.open = false
  confirmDialog.value.row = null
  confirmDialog.value.comment = ''
}

const confirmTitle = computed(() =>
  confirmDialog.value.action === 'APPROVE'
    ? 'Approve this leave request?'
    : 'Reject this leave request?'
)

const confirmPrimaryLabel = computed(() =>
  confirmDialog.value.action === 'APPROVE' ? 'Approve' : 'Reject'
)

const confirmPrimaryClasses = computed(() =>
  confirmDialog.value.action === 'APPROVE'
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : 'bg-rose-600 hover:bg-rose-700 text-white'
)

const rejectNeedsComment = computed(() => confirmDialog.value.action === 'REJECT')

async function submitDecision() {
  const { row, action, comment } = confirmDialog.value
  if (!row || !action) {
    closeDecisionDialog()
    return
  }

  if (action === 'REJECT' && !String(comment || '').trim()) {
    showToast({
      type: 'warning',
      title: 'Comment required',
      message: 'Please write a reason before rejecting.',
    })
    return
  }

  try {
    loading.value = true

    const payload =
      action === 'APPROVE'
        ? { action }
        : { action, comment: String(comment || '').trim() }

    await api.post(`/leave/requests/${row._id}/manager-decision`, payload)

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: 'Manager decision has been saved.',
    })

    closeDecisionDialog()
    // ✅ realtime will refresh too, but we refresh immediately for best UX
    await fetchInbox()
  } catch (e) {
    console.error('managerDecision error', e)
    showToast({
      type: 'error',
      title: 'Update failed',
      message: e?.response?.data?.message || 'Unable to update this leave request.',
    })
  } finally {
    loading.value = false
  }
}

/* ───────── Realtime ───────── */
const offHandlers = []
let refreshTimer = null

function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchInbox(), 150)
}

function setupRealtime() {
  subscribeRoleIfNeeded({
    role: auth.user?.role,
    employeeId: auth.user?.employeeId,
    // ✅ IMPORTANT: prefer loginId (string used in your leave rooms), not Mongo _id
    loginId: auth.user?.loginId || auth.user?.employeeId || auth.user?.id,
    company: auth.user?.companyCode,
  })

  const offCreated = onSocket('leave:req:created', (payload = {}) => {
    triggerRealtimeRefresh()
    if (payload.status === 'PENDING_MANAGER') {
      showToast({
        type: 'info',
        title: 'New leave request',
        message: `New leave from ${payload.employeeName || payload.employeeId || 'employee'}.`,
      })
    }
  })

  const offUpdated = onSocket('leave:req:updated', () => triggerRealtimeRefresh())
  const offManager = onSocket('leave:req:manager-decision', () => triggerRealtimeRefresh())
  const offGm = onSocket('leave:req:gm-decision', () => triggerRealtimeRefresh())

  offHandlers.push(offCreated, offUpdated, offManager, offGm)
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchInbox()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach(off => { try { off && off() } catch {} })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl ui-hero-gradient">
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Manager Inbox</p>
            <p class="text-[11px] text-sky-50/90">Review and approve expatriate leave requests assigned to you.</p>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/95">
                Total: {{ totalCount }}
              </span>
              <span class="rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white/95">
                Showing: {{ filteredCount }}
              </span>
            </div>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/30 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-100/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Employee / type / reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/70"
                />
              </div>
            </div>

            <!-- Status pills -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="text-sky-50/90 mr-1">Status</span>
              <div class="flex rounded-full bg-sky-900/30 p-0.5">
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusTab === 'PENDING_MANAGER'
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="statusTab = 'PENDING_MANAGER'"
                >
                  Pending (Manager)
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusTab === 'PENDING_GM'
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="statusTab = 'PENDING_GM'"
                >
                  Sent to GM
                </button>
              </div>
            </div>

            <!-- ✅ Requested at range filter (default empty = show all) -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="text-sky-50/80">Requested</span>
              <input
                v-model="fromDate"
                type="date"
                class="rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70"
              />
              <span>to</span>
              <input
                v-model="toDate"
                type="date"
                class="rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70"
              />
            </div>

            <!-- Expat ID filter -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="text-sky-50/80">Expat ID</span>
              <input
                v-model="employeeFilter"
                type="text"
                placeholder="EMP001..."
                class="w-28 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none placeholder:text-sky-100/70 focus:border-white focus:ring-1 focus:ring-white/70"
              />
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5
                       text-[11px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                @click="fetchInbox"
                :disabled="loading"
                title="Refresh"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                Refresh
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5
                       text-[11px] font-semibold text-slate-900 shadow hover:bg-white/95 transition"
                @click="clearFilters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile header -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Manager Inbox</p>
            <p class="text-[11px] text-sky-50/90">Review and approve expatriate leave requests assigned to you.</p>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/95">
                Total: {{ totalCount }}
              </span>
              <span class="rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white/95">
                Showing: {{ filteredCount }}
              </span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/30 px-2.5 py-1.5 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-100/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Employee / type / reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/70"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div class="flex items-center gap-1">
                <span class="text-sky-50/90">Status</span>
                <div class="flex rounded-full bg-sky-900/30 p-0.5">
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusTab === 'PENDING_MANAGER' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                    @click="statusTab = 'PENDING_MANAGER'"
                  >
                    Manager
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusTab === 'PENDING_GM' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                    @click="statusTab = 'PENDING_GM'"
                  >
                    GM
                  </button>
                </div>
              </div>

              <input
                v-model="employeeFilter"
                type="text"
                placeholder="Expat ID..."
                class="w-24 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none placeholder:text-sky-100/70 focus:border-white focus:ring-1 focus:ring-white/70"
              />
            </div>

            <!-- ✅ Requested at range filter (mobile) -->
            <div class="flex flex-wrap items-center gap-2 text-[11px]">
              <span class="text-sky-50/80">Requested</span>
              <input
                v-model="fromDate"
                type="date"
                class="flex-1 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70"
              />
              <span>to</span>
              <input
                v-model="toDate"
                type="date"
                class="flex-1 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70"
              />
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5
                       text-[11px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                @click="fetchInbox"
                :disabled="loading"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                Refresh
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5
                       text-[11px] font-semibold text-slate-900 shadow hover:bg-white/95 transition"
                @click="clearFilters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <div
          v-if="loading && !filteredRows.length"
          class="mb-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px]
                 text-sky-700 dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
        >
          Loading manager inbox...
        </div>

        <!-- Mobile cards -->
        <div v-if="isMobile" class="space-y-2">
          <p v-if="!pagedRows.length && !loading" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
            No leave requests in your manager queue.
          </p>

          <article
            v-for="row in pagedRows"
            :key="row._id"
            class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                   shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                   dark:border-slate-700 dark:bg-slate-900/95"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  Requested:
                  <span class="font-medium text-slate-800 dark:text-slate-100">
                    {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </span>
                </div>

                <div class="text-xs font-mono text-slate-800 dark:text-slate-100">
                  {{ row.employeeId || '—' }}
                </div>
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                  {{ row.employeeName || '—' }}
                </div>

                <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ row.department }}
                </div>

                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  Date: <span class="font-medium">{{ formatRange(row) }}</span>
                  · Days: <span class="font-semibold">{{ Number(row.totalDays || 0).toLocaleString() }}</span>
                </div>
              </div>

              <div class="text-right space-y-1 text-[11px]">
                <span class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80">
                  {{ row.leaveTypeCode || '—' }}
                </span>
                <div>
                  <span class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        :class="statusChipClasses(row.status)">
                    {{ row.status }}
                  </span>
                </div>
              </div>
            </div>

            <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span class="font-medium">Reason:</span> <span>{{ row.reason || '—' }}</span>
            </div>

            <div class="mt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1
                       text-[11px] font-semibold text-slate-700 hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                @click="goProfile(row)"
              >
                <i class="fa-solid fa-id-badge text-[10px]" />
                Profile
              </button>

              <template v-if="canManagerDecide && row.status === 'PENDING_MANAGER'">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700"
                  @click="openDecisionDialog(row, 'APPROVE')"
                >
                  <i class="fa-solid fa-check text-[10px]" />
                  Approve
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50
                         dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                  @click="openDecisionDialog(row, 'REJECT')"
                >
                  <i class="fa-solid fa-xmark text-[10px]" />
                  Reject
                </button>
              </template>

              <template v-else>
                <span class="text-[11px] text-slate-400 dark:text-slate-500">No action available</span>
              </template>
            </div>
          </article>
        </div>

        <!-- Desktop table -->
        <div v-else class="overflow-x-auto">
          <table class="min-w-[1040px] w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
            <thead class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300">
              <tr>
                <th class="table-th">Requested at</th>
                <th class="table-th">Employee</th>
                <th class="table-th">Type</th>
                <th class="table-th">Date range</th>
                <th class="table-th text-right">Days</th>
                <th class="table-th">Reason</th>
                <th class="table-th text-center">Status</th>
                <th class="table-th text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="!loading && !filteredRows.length">
                <td colspan="8" class="px-3 py-6 text-center text-[12px] text-slate-500 border-t border-slate-200 dark:border-slate-700 dark:text-slate-400">
                  No leave requests in your manager queue.
                </td>
              </tr>

              <tr
                v-for="row in pagedRows"
                :key="row._id"
                class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
              >
                <td class="table-td whitespace-nowrap align-top">
                  {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                </td>

                <td class="table-td align-top">
                  <div class="text-xs font-mono text-slate-900 dark:text-slate-50">
                    {{ row.employeeId || '—' }}
                  </div>
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                    {{ row.employeeName || '—' }}
                  </div>
                  <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ row.department }}
                  </div>
                </td>

                <td class="table-td align-top">
                  <span class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80">
                    {{ row.leaveTypeCode || '—' }}
                  </span>
                </td>

                <td class="table-td whitespace-nowrap align-top">{{ formatRange(row) }}</td>
                <td class="table-td text-right align-top">{{ Number(row.totalDays || 0).toLocaleString() }}</td>

                <td class="table-td align-top">
                  <p class="text-truncate-2 text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                    {{ row.reason || '—' }}
                  </p>
                </td>

                <td class="table-td text-center align-top">
                  <span class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" :class="statusChipClasses(row.status)">
                    {{ row.status }}
                  </span>
                </td>

                <td class="table-td text-right align-top">
                  <div class="inline-flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1
                             text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50
                             dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                      @click="goProfile(row)"
                    >
                      <i class="fa-solid fa-id-badge text-[10px]" />
                      Profile
                    </button>

                    <template v-if="canManagerDecide && row.status === 'PENDING_MANAGER'">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-700"
                        @click="openDecisionDialog(row, 'APPROVE')"
                      >
                        <i class="fa-solid fa-check text-[10px]" />
                        Approve
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50
                               dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                        @click="openDecisionDialog(row, 'REJECT')"
                      >
                        <i class="fa-solid fa-xmark text-[10px]" />
                        Reject
                      </button>
                    </template>

                    <template v-else>
                      <span class="text-[11px] text-slate-400 dark:text-slate-500">No action</span>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
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

    <!-- Confirm dialog -->
    <transition name="modal-fade">
      <div v-if="confirmDialog.open" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <!-- Header -->
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200">
                  <i v-if="confirmDialog.action === 'APPROVE'" class="fa-solid fa-check text-sm" />
                  <i v-else class="fa-solid fa-xmark text-sm" />
                </div>
                <div>
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ confirmTitle }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ rejectNeedsComment ? 'Comment is required for rejection.' : 'No comment needed for approval.' }}
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="closeDecisionDialog"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="px-4 py-3">
            <div v-if="confirmDialog.row" class="mb-2 text-[11px] text-slate-700 dark:text-slate-100">
              <span class="font-semibold">
                {{ confirmDialog.row.employeeId || '—' }} — {{ confirmDialog.row.employeeName || '—' }}
              </span>
              <span class="text-slate-500 dark:text-slate-400">
                · {{ formatRange(confirmDialog.row) }}
                · {{ confirmDialog.row.leaveTypeCode || '—' }}
              </span>
            </div>

            <div v-if="rejectNeedsComment" class="mt-2">
              <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Rejection comment <span class="text-rose-600">*</span>
              </label>
              <textarea
                v-model="confirmDialog.comment"
                rows="3"
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs
                       shadow-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="Write the reason for rejection…"
              ></textarea>
              <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Required. This will be stored with the decision.
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="closeDecisionDialog"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm
                     focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-50 dark:focus:ring-offset-slate-900"
              :class="confirmPrimaryClasses"
              :disabled="loading"
              @click="submitDecision"
            >
              <i class="fa-solid mr-1 text-[10px]" :class="confirmDialog.action === 'APPROVE' ? 'fa-check' : 'fa-xmark'" />
              <span>{{ confirmPrimaryLabel }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.table-th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; }
.table-td { padding: 8px 10px; vertical-align: top; }

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
.dark .pagination-btn { background: #020617; border-color: rgba(148, 163, 184, 0.9); color: #e5e7eb; }
.dark .pagination-btn:not(:disabled):hover { background: #1e293b; }

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
 