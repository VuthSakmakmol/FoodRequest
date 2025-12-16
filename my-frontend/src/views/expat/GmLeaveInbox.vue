<!-- src/views/expat/GmLeaveInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

const router = useRouter()
const { showToast } = useToast()
const auth = useAuth()

/* ✅ roles helper (supports user.role + user.roles[]) */
const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const base = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...base])]
})
const canGmDecide = computed(() => roles.value.includes('LEAVE_GM'))

/* ───────── Responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── State ───────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusTab = ref('PENDING_GM') // 'PENDING_GM' | 'FINISHED'

/* Filters */
const fromDate = ref(dayjs().format('YYYY-MM-DD'))
const toDate = ref(dayjs().format('YYYY-MM-DD'))
const employeeFilter = ref('')

/* Pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

function formatRange(row) {
  const s = row.startDate || ''
  const e = row.endDate || ''
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

/* Sort order for GM queue */
function statusWeight(s) {
  switch (s) {
    case 'PENDING_GM': return 0
    case 'APPROVED': return 1
    case 'REJECTED': return 2
    case 'CANCELLED': return 3
    case 'PENDING_MANAGER': return 4
    default: return 99
  }
}

/* ✅ Reject reason + who rejected */
function getRejectReason(row) {
  const gm = String(row?.gmComment || '').trim()
  const mgr = String(row?.managerComment || '').trim()
  return gm || mgr || ''
}
function rejectedByLabel(row) {
  const gm = String(row?.gmComment || '').trim()
  const mgr = String(row?.managerComment || '').trim()
  if (gm) return 'Rejected by GM'
  if (mgr) return 'Rejected by Manager'
  return 'Rejected'
}

/* ✅ Go to GM Profile page and auto-select that expat */
function goProfile(row) {
  const empId = String(row?.employeeId || '').trim()
  if (!empId) return
  router.push({ name: 'leave-gm-profile', query: { employeeId: empId } })
}

/* ───────── Data ───────── */
async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/gm/inbox')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchInbox error', e)
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: e?.response?.data?.message || 'Unable to load GM inbox.'
    })
  } finally {
    loading.value = false
  }
}

/**
 * Tabs:
 * - PENDING_GM: show all rows for this GM
 * - FINISHED:   only APPROVED/REJECTED/CANCELLED
 */
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const empQ = employeeFilter.value.trim().toLowerCase()

  const fromVal = fromDate.value ? dayjs(fromDate.value).startOf('day').valueOf() : null
  const toVal = toDate.value ? dayjs(toDate.value).endOf('day').valueOf() : null

  let list = [...rows.value]

  if (empQ) {
    list = list.filter(r => String(r.employeeId || '').toLowerCase().includes(empQ))
  }

  if (q) {
    list = list.filter(r =>
      String(r.employeeId || '').toLowerCase().includes(q) ||
      String(r.employeeName || '').toLowerCase().includes(q) ||
      String(r.department || '').toLowerCase().includes(q) ||
      String(r.leaveTypeCode || '').toLowerCase().includes(q) ||
      String(r.reason || '').toLowerCase().includes(q) ||
      String(r.gmComment || '').toLowerCase().includes(q) ||
      String(r.managerComment || '').toLowerCase().includes(q)
    )
  }

  if (statusTab.value === 'FINISHED') {
    list = list.filter(r => ['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status))
  }

  if (fromVal !== null || toVal !== null) {
    list = list.filter(r => {
      if (!r.startDate) return false
      const start = dayjs(r.startDate).startOf('day').valueOf()
      if (fromVal !== null && start < fromVal) return false
      if (toVal !== null && start > toVal) return false
      return true
    })
  }

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
const rejectError = ref('')

function openDecisionDialog(row, action) {
  if (!canGmDecide.value) {
    showToast({ type: 'error', title: 'Not allowed', message: 'You do not have permission to approve or reject as GM.' })
    return
  }
  confirmDialog.value.open = true
  confirmDialog.value.row = row
  confirmDialog.value.action = action
  confirmDialog.value.comment = ''
  rejectError.value = ''
}

function closeDecisionDialog() {
  confirmDialog.value.open = false
  confirmDialog.value.row = null
  confirmDialog.value.comment = ''
  rejectError.value = ''
}

const confirmTitle = computed(() =>
  confirmDialog.value.action === 'APPROVE' ? 'Approve this leave request?' : 'Reject this leave request?'
)

const confirmPrimaryLabel = computed(() =>
  confirmDialog.value.action === 'APPROVE' ? 'Approve' : 'Reject'
)

const confirmPrimaryClasses = computed(() =>
  confirmDialog.value.action === 'APPROVE'
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : 'bg-rose-600 hover:bg-rose-700 text-white'
)

/* ✅ Approve: no comment sent. Reject: comment required. */
async function submitDecision() {
  const { row, action } = confirmDialog.value
  const comment = String(confirmDialog.value.comment || '').trim()

  if (!row || !action) {
    closeDecisionDialog()
    return
  }

  if (action === 'REJECT' && !comment) {
    rejectError.value = 'Reject reason is required.'
    return
  }

  try {
    loading.value = true
    await api.post(`/leave/requests/${row._id}/gm-decision`, {
      action,
      ...(action === 'REJECT' ? { comment } : {})
    })

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: 'GM decision has been saved.'
    })

    closeDecisionDialog()
    await fetchInbox()
  } catch (e) {
    console.error('gmDecision error', e)
    showToast({
      type: 'error',
      title: 'Update failed',
      message: e?.response?.data?.message || 'Unable to update this leave request.'
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
    loginId: auth.user?.id,
    company: auth.user?.companyCode
  })

  const offCreated = onSocket('leave:req:created', () => triggerRealtimeRefresh())
  const offUpdated = onSocket('leave:req:updated', () => triggerRealtimeRefresh())
  const offMgr = onSocket('leave:req:manager-decision', () => triggerRealtimeRefresh())
  const offGm = onSocket('leave:req:gm-decision', () => triggerRealtimeRefresh())

  offHandlers.push(offCreated, offUpdated, offMgr, offGm)
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
      <div class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500 px-4 py-3 text-white">
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">GM Inbox</p>
            <p class="text-[11px] text-sky-50/90">Final approval queue for expatriate leave requests.</p>
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
                  placeholder="Employee / type / reason / reject note..."
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
                  :class="statusTab === 'PENDING_GM' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="statusTab = 'PENDING_GM'"
                >
                  Pending (GM)
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusTab === 'FINISHED' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="statusTab = 'FINISHED'"
                >
                  Finished
                </button>
              </div>
            </div>

            <!-- Date range -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="text-sky-50/80">Start</span>
              <input v-model="fromDate" type="date" class="rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70" />
              <span>to</span>
              <input v-model="toDate" type="date" class="rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70" />
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
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">GM Inbox</p>
            <p class="text-[11px] text-sky-50/90">Final approval queue for expatriate leave requests.</p>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/30 px-2.5 py-1.5 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-100/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Employee / type / reason / reject note..."
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
                    :class="statusTab === 'PENDING_GM' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                    @click="statusTab = 'PENDING_GM'"
                  >
                    Pending
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusTab === 'FINISHED' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                    @click="statusTab = 'FINISHED'"
                  >
                    Finished
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

            <div class="flex flex-wrap items-center gap-2 text-[11px]">
              <span class="text-sky-50/80">Start</span>
              <input v-model="fromDate" type="date" class="flex-1 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70" />
              <span>to</span>
              <input v-model="toDate" type="date" class="flex-1 rounded-lg border border-sky-100/80 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-50 outline-none focus:border-white focus:ring-1 focus:ring-white/70" />
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <div
          v-if="loading && !filteredRows.length"
          class="mb-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700
                 dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
        >
          Loading GM inbox...
        </div>

        <!-- Mobile cards -->
        <div v-if="isMobile" class="space-y-2">
          <p v-if="!pagedRows.length && !loading" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
            No leave requests in your GM queue.
          </p>

          <article
            v-for="row in pagedRows"
            :key="row._id"
            class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                   dark:border-slate-700 dark:bg-slate-900/95"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border" :class="statusChipClasses(row.status)">
                  {{ row.status }}
                </span>

                <div class="text-xs font-mono text-slate-800 dark:text-slate-100">
                  {{ row.employeeId || '—' }}
                </div>

                <div v-if="row.employeeName || row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ row.employeeName || '' }} <span v-if="row.department">· {{ row.department }}</span>
                </div>

                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  Date: <span class="font-medium">{{ formatRange(row) }}</span>
                  · Days: <span class="font-semibold">{{ Number(row.totalDays || 0).toLocaleString() }}</span>
                </div>
              </div>

              <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                <div class="whitespace-nowrap">
                  {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                </div>
                <div class="mt-1">
                  <span class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80">
                    {{ row.leaveTypeCode || '—' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="mt-2 h-px bg-slate-200 dark:bg-slate-800" />

            <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span class="font-medium">Request reason:</span>
              <span class="text-truncate-2 inline-block align-top">{{ row.reason || '—' }}</span>
            </div>

            <!-- ✅ Reject reason (GM or Manager) -->
            <div
              v-if="row.status === 'REJECTED'"
              class="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700
                     dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <span class="font-semibold">{{ rejectedByLabel(row) }}<span v-if="row.department"> ({{ row.department }})</span>:</span>
              <span class="ml-1">{{ getRejectReason(row) || '—' }}</span>
            </div>

            <!-- Actions -->
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                @click="goProfile(row)"
              >
                <i class="fa-solid fa-id-badge text-[10px]" />
                Profile
              </button>

              <template v-if="canGmDecide && row.status === 'PENDING_GM'">
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

              <!-- ✅ Removed "Rejected by ..." chip in Actions to avoid duplication -->

              <template v-else>
                <span class="text-[11px] text-slate-400 dark:text-slate-500">No action available</span>
              </template>
            </div>
          </article>
        </div>

        <!-- Desktop table -->
        <div v-else class="overflow-x-auto">
          <table class="min-w-[1100px] w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
            <thead class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300">
              <tr>
                <th class="table-th">Requested at</th>
                <th class="table-th">Employee</th>
                <th class="table-th">Type</th>
                <th class="table-th">Date range</th>
                <th class="table-th text-right">Days</th>
                <th class="table-th">Request reason</th>
                <th class="table-th text-center">Status</th>
                <th class="table-th text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="!loading && !filteredRows.length">
                <td colspan="8" class="px-3 py-6 text-center text-[12px] text-slate-500 border-t border-slate-200 dark:border-slate-700 dark:text-slate-400">
                  No leave requests in your GM queue.
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
                  <div v-if="row.employeeName || row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ row.employeeName || '' }} <span v-if="row.department">· {{ row.department }}</span>
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
                  <p class="text-truncate-2 text-xs sm:text-[13px]">{{ row.reason || '—' }}</p>

                  <div
                    v-if="row.status === 'REJECTED'"
                    class="mt-2 inline-flex max-w-[520px] items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700
                           dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
                  >
                    <span class="font-semibold whitespace-nowrap">
                      {{ rejectedByLabel(row) }}<span v-if="row.department"> ({{ row.department }})</span>:
                    </span>
                    <span class="min-w-0 break-words">{{ getRejectReason(row) || '—' }}</span>
                  </div>
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
                      class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50
                             dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                      @click="goProfile(row)"
                    >
                      <i class="fa-solid fa-id-badge text-[10px]" />
                      Profile
                    </button>

                    <template v-if="canGmDecide && row.status === 'PENDING_GM'">
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

                    <!-- ✅ Removed rejected chip in Actions -->

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
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ confirmTitle }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    <span v-if="confirmDialog.action === 'APPROVE'">No comment needed for approve.</span>
                    <span v-else>Reject requires a reason.</span>
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
            <div class="text-[12px] text-slate-700 dark:text-slate-100">
              <div v-if="confirmDialog.row" class="mb-2 text-[11px]">
                <div class="font-semibold">
                  {{ confirmDialog.row.employeeId }} — {{ confirmDialog.row.employeeName || '—' }}
                  <span v-if="confirmDialog.row.department" class="font-normal text-slate-500 dark:text-slate-400">· {{ confirmDialog.row.department }}</span>
                </div>
                <div class="text-slate-500 dark:text-slate-400">
                  {{ formatRange(confirmDialog.row) }} · {{ confirmDialog.row.leaveTypeCode }} · Days: {{ Number(confirmDialog.row.totalDays || 0).toLocaleString() }}
                </div>
                <div class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
                  <span class="font-semibold">Request reason:</span>
                  <span class="ml-1">{{ confirmDialog.row.reason || '—' }}</span>
                </div>
              </div>
            </div>

            <!-- ✅ Reject comment only -->
            <div v-if="confirmDialog.action === 'REJECT'" class="mt-3">
              <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Reject reason <span class="text-rose-600">*</span>
              </label>
              <textarea
                v-model="confirmDialog.comment"
                rows="3"
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs shadow-sm
                       focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="Write reject reason..."
                @input="rejectError = ''"
              ></textarea>

              <p v-if="rejectError" class="mt-1 text-[11px] font-semibold text-rose-600">
                {{ rejectError }}
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
.dark .pagination-btn { background: #020617; color: #e5e7eb; border-color: rgba(148, 163, 184, 0.9); }
.dark .pagination-btn:not(:disabled):hover { background: #1e293b; }

.modal-fade-enter-active, .modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
