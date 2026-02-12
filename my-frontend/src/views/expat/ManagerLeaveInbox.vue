<!-- src/views/expat/ManagerLeaveInbox.vue
  ✅ Same UI system as ManagerLeaveInbox.vue (ui-page / ui-card / ui-hero-gradient / ui-table)
  ✅ Edge-to-edge (no wasted edges)
  ✅ Responsive: mobile cards + desktop fixed table with aligned columns
  ✅ Filters: search + requested date range (+ optional expat id)
  ✅ Actions: Export CSV (Excel compatible) + Refresh + Clear
  ✅ NOW: Approve + Reject buttons (Manager action)
  ✅ Keep realtime refresh
  ✅ NO SweetAlert / NO window.alert (custom confirm modal)
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'ManagerLeaveInbox' })

const { showToast } = useToast()
const auth = useAuth()

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

/* ✅ Filters (default empty = show all) */
const fromDate = ref('') // Requested at (createdAt)
const toDate = ref('') // Requested at (createdAt)
const employeeFilter = ref('') // optional expat id filter

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
    case 'PENDING_MANAGER':
      return 0
    case 'PENDING_GM':
      return 1
    case 'APPROVED':
      return 2
    case 'REJECTED':
      return 3
    case 'CANCELLED':
      return 4
    default:
      return 99
  }
}

/* quick tools */

async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/manager/inbox?scope=ALL')
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

  if (empQ) list = list.filter((r) => String(r.employeeId || '').toLowerCase().includes(empQ))

  if (q) {
    list = list.filter(
      (r) =>
        String(r.employeeId || '').toLowerCase().includes(q) ||
        String(r.employeeName || '').toLowerCase().includes(q) ||
        String(r.department || '').toLowerCase().includes(q) ||
        String(r.leaveTypeCode || '').toLowerCase().includes(q) ||
        String(r.reason || '').toLowerCase().includes(q) ||
        String(r.status || '').toLowerCase().includes(q)
    )
  }

  // ✅ Date filter by REQUEST DATE (createdAt)
  const fromVal = fromDate.value ? dayjs(fromDate.value).startOf('day').valueOf() : null
  const toVal = toDate.value ? dayjs(toDate.value).endOf('day').valueOf() : null

  if (fromVal !== null || toVal !== null) {
    list = list.filter((r) => {
      if (!r.createdAt) return false
      const t = dayjs(r.createdAt).valueOf()
      if (fromVal !== null && t < fromVal) return false
      if (toVal !== null && t > toVal) return false
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

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

watch(
  () => [search.value, fromDate.value, toDate.value, employeeFilter.value, perPage.value],
  () => {
    page.value = 1
  }
)

/* ───────── Export to Excel (CSV download; works without extra libs) ───────── */
function csvEscape(v) {
  const s = String(v ?? '')
  const needs = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function buildExportRows(list) {
  return (list || []).map((r) => ({
    RequestedAt: r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
    EmployeeId: r.employeeId || '',
    EmployeeName: r.employeeName || '',
    Department: r.department || '',
    LeaveType: r.leaveTypeCode || '',
    LeaveStart: r.startDate ? dayjs(r.startDate).format('YYYY-MM-DD') : '',
    LeaveEnd: r.endDate ? dayjs(r.endDate).format('YYYY-MM-DD') : '',
    TotalDays: Number(r.totalDays || 0),
    Status: r.status || '',
    Reason: (r.reason || '').replace(/\s+/g, ' ').trim(),
  }))
}

function exportExcel(scope = 'FILTERED') {
  try {
    const list = scope === 'ALL' ? rows.value : filteredRows.value
    if (!list.length) {
      showToast({ type: 'warning', title: 'Nothing to export', message: 'No rows available for export.' })
      return
    }

    const data = buildExportRows(list)
    const headers = Object.keys(data[0])

    const csv = [
      headers.map(csvEscape).join(','),
      ...data.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
    ].join('\n')

    const tag =
      scope === 'ALL'
        ? 'ALL'
        : `${fromDate.value ? `_${fromDate.value}` : ''}${toDate.value ? `_${toDate.value}` : ''}` || 'FILTERED'

    downloadTextFile(`ManagerInbox_${tag}_${dayjs().format('YYYYMMDD_HHmm')}.csv`, csv)

    showToast({ type: 'success', title: 'Exported', message: 'Downloaded CSV (Excel compatible).' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: 'Unable to export. Please try again.' })
  }
}

/* ───────── Approve / Reject ───────── */
const deciding = ref(false)
const decideId = ref('') // request _id
const decideAction = ref('') // 'APPROVE' | 'REJECT'
const rejectNote = ref('')

const canDecide = (row) => String(row?.status || '').toUpperCase() === 'PENDING_MANAGER'

function openApprove(row) {
  if (!row?._id) return
  decideId.value = row._id
  decideAction.value = 'APPROVE'
  rejectNote.value = ''
}

function openReject(row) {
  if (!row?._id) return
  decideId.value = row._id
  decideAction.value = 'REJECT'
  rejectNote.value = ''
}

function closeDecisionModal(force = false) {
  if (!force && deciding.value) return
  decideId.value = ''
  decideAction.value = ''
  rejectNote.value = ''
}


async function confirmDecision() {
  if (!decideId.value || !decideAction.value) return

  const action = decideAction.value === 'APPROVE' ? 'APPROVE' : 'REJECT'
  const comment = action === 'REJECT' ? rejectNote.value.trim() : ''

  if (action === 'REJECT' && !comment) {
    showToast({ type: 'warning', title: 'Reject reason required', message: 'Please enter a short reason to reject.' })
    return
  }

  try {
    deciding.value = true

    await api.post(`/leave/requests/${decideId.value}/manager-decision`, { action, comment })

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: action === 'APPROVE' ? 'Sent to GM queue.' : 'Request rejected.',
    })

    // ✅ AUTO CLOSE immediately after success
    closeDecisionModal(true)

    await fetchInbox()
  } catch (e) {
    console.error('confirmDecision error', e)
    showToast({
      type: 'error',
      title: 'Action failed',
      message: e?.response?.data?.message || 'Unable to update request. Please try again.',
    })
  } finally {
    deciding.value = false
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
    loginId: auth.user?.loginId || auth.user?.employeeId || auth.user?.id,
    company: auth.user?.companyCode,
  })

  const offCreated = onSocket('leave:req:created', () => triggerRealtimeRefresh())
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
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="ui-container-edge">
      <div class="ui-card rounded-none border-x-0 border-t-0">
        <div class="ui-hero-gradient">
          <!-- Desktop header -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-[240px]">
              <p class="text-[15px] font-extrabold">Manager Inbox</p>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
              <!-- Search -->
              <div class="min-w-[240px] max-w-xs">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Search</label>
                  <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                    <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                    <input
                      v-model="search"
                      type="text"
                      placeholder="Employee / type / reason..."
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                    />
                  </div>
                </div>
              </div>

              <!-- Requested at range filter -->
              <div class="flex items-end gap-2">
                <div class="ui-field w-[150px]">
                  <label class="text-[11px] font-extrabold text-white/90">Requested from</label>
                  <input v-model="fromDate" type="date" class="ui-date" />
                </div>
                <div class="ui-field w-[150px]">
                  <label class="text-[11px] font-extrabold text-white/90">Requested to</label>
                  <input v-model="toDate" type="date" class="ui-date" />
                </div>
              </div>

              <!-- Expat ID filter -->
              <div class="ui-field w-[140px]">
                <label class="text-[11px] font-extrabold text-white/90">Expat ID</label>
                <input
                  v-model="employeeFilter"
                  type="text"
                  placeholder="001..."
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/70"
                />
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel('FILTERED')"
                  :disabled="loading || !filteredRows.length"
                  title="Export filtered list to Excel"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile header -->
          <div v-else class="space-y-3">
            <div>
              <p class="text-[15px] font-extrabold">Manager Inbox</p>
            </div>

            <div class="space-y-2">
              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee / type / reason..."
                    class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Expat ID</label>
                <input
                  v-model="employeeFilter"
                  type="text"
                  placeholder="001..."
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/70"
                />
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Requested from</label>
                  <input v-model="fromDate" type="date" class="ui-date" />
                </div>
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Requested to</label>
                  <input v-model="toDate" type="date" class="ui-date" />
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel('FILTERED')"
                  :disabled="loading || !filteredRows.length"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>


              </div>

              <div class="flex justify-end">
                <button
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-ghost"
                  @click="exportExcel('ALL')"
                  :disabled="loading || !rows.length"
                >
                  Export ALL
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div
            v-if="loading && !filteredRows.length"
            class="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700
                   dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
          >
            Loading manager inbox...
          </div>

          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedRows.length && !loading" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave requests in your manager queue.
            </p>

            <article v-for="row in pagedRows" :key="row._id" class="ui-card p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Requested:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </span>
                  </div>

                  <div class="text-xs font-mono text-slate-900 dark:text-slate-50">
                    {{ row.employeeId || '—' }}
                  </div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ row.employeeName || '—' }}
                  </div>

                  <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ row.department }}
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Date: <span class="font-semibold">{{ formatRange(row) }}</span>
                    · Days: <span class="font-extrabold">{{ Number(row.totalDays || 0).toLocaleString() }}</span>
                  </div>
                </div>

                <div class="text-right space-y-1 text-[11px]">
                  <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  <div>
                    <span
                      class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      :class="statusChipClasses(row.status)"
                    >
                      {{ row.status }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="font-semibold">Reason:</span> <span>{{ row.reason || '—' }}</span>
              </div>

              <!-- ✅ Actions (only if PENDING_MANAGER) -->
              <div v-if="canDecide(row)" class="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-emerald"
                  :disabled="loading || deciding"
                  @click="openApprove(row)"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-rose"
                  :disabled="loading || deciding"
                  @click="openReject(row)"
                >
                  <i class="fa-solid fa-circle-xmark text-[11px]" />
                  Reject
                </button>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table text-left min-w-[1240px]">
              <colgroup>
                <col class="w-[150px]" />
                <col class="w-[260px]" />
                <col class="w-[92px]" />
                <col class="w-[160px]" />
                <col class="w-[80px]" />
                <col />
                <col class="w-[170px]" />
                <col class="w-[170px]" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th text-left">Requested at</th>
                  <th class="ui-th text-left">Employee</th>
                  <th class="ui-th text-left">Type</th>
                  <th class="ui-th text-left">Leave Date</th>
                  <th class="ui-th text-right">Days</th>
                  <th class="ui-th text-left">Reason</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !filteredRows.length">
                  <td colspan="8" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No leave requests in your manager queue.
                  </td>
                </tr>

                <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td text-left whitespace-nowrap align-top">
                    {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td text-left align-top">
                    <div class="text-xs font-mono text-slate-900 dark:text-slate-50">
                      {{ row.employeeId || '—' }}
                    </div>
                    <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                      {{ row.employeeName || '—' }}
                    </div>
                    <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ row.department }}
                    </div>
                  </td>

                  <td class="ui-td text-left align-top">
                    <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  </td>

                  <td class="ui-td text-left whitespace-nowrap align-top">{{ formatRange(row) }}</td>

                  <td class="ui-td text-right align-top tabular-nums">{{ Number(row.totalDays || 0).toLocaleString() }}</td>

                  <td class="ui-td text-left align-top">
                    <p class="reason-cell">{{ row.reason || '—' }}</p>
                  </td>

                  <td class="ui-td align-top">
                    <span
                      class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      :class="statusChipClasses(row.status)"
                    >
                      {{ row.status }}
                    </span>
                  </td>

                  <!-- ✅ Actions -->
                  <td class="ui-td align-top text-center">
                    <div v-if="canDecide(row)" class="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        class="ui-btn ui-btn-xs ui-btn-emerald"
                        :disabled="loading || deciding"
                        @click="openApprove(row)"
                      >
                        <i class="fa-solid fa-circle-check text-[11px]" />
                        Approve
                      </button>
                      <button
                        type="button"
                        class="ui-btn ui-btn-xs ui-btn-rose"
                        :disabled="loading || deciding"
                        @click="openReject(row)"
                      >
                        <i class="fa-solid fa-circle-xmark text-[11px]" />
                        Reject
                      </button>
                    </div>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="mt-3 flex flex-col gap-2 ui-divider pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <select v-model="perPage" class="ui-select !w-auto !py-1.5 !text-[11px]">
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Confirm modal (Approve / Reject) -->
    <div v-if="!!decideAction" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeDecisionModal" />
      <div class="absolute inset-0 flex items-center justify-center p-3">
        <div class="ui-card w-full max-w-lg p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ decideAction === 'APPROVE' ? 'Approve request' : 'Reject request' }}
              </p>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                This will update the request status immediately.
              </p>
            </div>
            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closeDecisionModal" :disabled="deciding">
              <i class="fa-solid fa-xmark" />
            </button>
          </div>

          <div class="mt-3 space-y-2">
            <div
              v-if="decideAction === 'REJECT'"
              class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <label class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">Reject reason</label>
              <textarea
                v-model="rejectNote"
                rows="3"
                class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none
                       placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                placeholder="Example: Not enough coverage during that period..."
              />
              <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Required. This reason will be visible in request history.
              </p>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closeDecisionModal" :disabled="deciding">
                Cancel
              </button>

              <button
                v-if="decideAction === 'APPROVE'"
                type="button"
                class="ui-btn ui-btn-sm ui-btn-emerald"
                @click="confirmDecision"
                :disabled="deciding"
              >
                <i class="fa-solid fa-circle-check text-[11px]" />
                {{ deciding ? 'Approving...' : 'Approve' }}
              </button>

              <button
                v-else
                type="button"
                class="ui-btn ui-btn-sm ui-btn-rose"
                @click="confirmDecision"
                :disabled="deciding"
              >
                <i class="fa-solid fa-circle-xmark text-[11px]" />
                {{ deciding ? 'Rejecting...' : 'Reject' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>
