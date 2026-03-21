<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'

import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'

import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'
// import AttachmentPreviewModal from '@/views/expat/user/swap-day/AttachmentPreviewModal.vue'

defineOptions({ name: 'SwapDayReport' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL')
const approvalMode = ref('ALL')
const employeeIdFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')

/* pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

/* view modal */
const viewOpen = ref(false)
const viewItem = ref(null)

/* attachments modal */
const filesOpen = ref(false)
const filesRequest = ref(null)
const filesItems = ref([])

/* export */
const exporting = ref(false)

/* ───────────────── COLUMN WIDTH CONFIG (DESKTOP TABLE) ───────────────── */
const COL_WIDTH = {
  created: '150px',
  employee: '250px',
  mode: '170px',
  workDate: '190px',
  swapDate: '190px',
  status: '140px',
  reason: '240px',
}

/* ───────────────── CONSTANTS ───────────────── */
const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

const APPROVAL_MODE_LABEL = {
  ALL: 'All',
  MANAGER_AND_GM: 'Manager + GM',
  MANAGER_AND_COO: 'Manager + COO',
  GM_AND_COO: 'GM + COO',
}

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function fmtDateTime(v) {
  if (!v) return '—'
  return dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'
}
function fmtYmd(v) {
  if (!v) return '—'
  return dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'
}

function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}
function briefText(v, max = 80) {
  const t = compactText(v)
  if (!t) return '—'
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
}

function statusBadgeUiClass(x) {
  const st = up(x)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function modeLabel(v) {
  const m = up(v)
  return APPROVAL_MODE_LABEL[m] || m || '—'
}

function normalizeEvidenceList(list) {
  const arr = Array.isArray(list) ? list : []
  return arr.map((x) => ({ ...x, attId: x?.attId || x?.fileId }))
}

/* ✅ Reason fallback */
function reasonText(row) {
  const r = row || {}
  const candidates = [
    r.reason,
    r.requestReason,
    r.note,
    r.remark,
    r.comments,
    r.description,
  ]
  const pick = candidates.map(compactText).find((x) => !!x)
  return pick || '—'
}

/* ───────────────── small stats ───────────────── */
const pendingCount = computed(() =>
  rows.value.filter((r) => up(r.status).includes('PENDING')).length
)
const approvedCount = computed(() =>
  rows.value.filter((r) => up(r.status) === 'APPROVED').length
)
const rejectedCount = computed(() =>
  rows.value.filter((r) => up(r.status) === 'REJECTED').length
)

/* ───────────────── API ───────────────── */
function buildQuery() {
  const q = {}

  if (s(search.value)) q.q = s(search.value)
  if (statusFilter.value !== 'ALL') q.status = up(statusFilter.value)
  if (approvalMode.value !== 'ALL') q.approvalMode = up(approvalMode.value)
  if (s(employeeIdFilter.value)) q.employeeId = s(employeeIdFilter.value)

  const df = s(dateFrom.value)
  const dt = s(dateTo.value)
  if ((df && !dt) || (!df && dt)) {
    showToast({ type: 'warning', message: 'Please provide both date from and date to.' })
  } else if (df && dt) {
    q.from = df
    q.to = dt
  }

  q.scope = 'ALL'
  return q
}

async function fetchRows() {
  try {
    loading.value = true
    const params = buildQuery()
    const res = await api.get('/leave/swap-working-day/admin', { params })
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load swap day report' })
  } finally {
    loading.value = false
  }
}

/* ───────────────── FILTER (local safety) ───────────────── */
const filteredRows = computed(() => {
  let list = [...rows.value]

  if (statusFilter.value !== 'ALL') {
    list = list.filter((r) => up(r.status) === up(statusFilter.value))
  }

  if (approvalMode.value !== 'ALL') {
    list = list.filter((r) => up(r.approvalMode) === up(approvalMode.value))
  }

  if (s(employeeIdFilter.value)) {
    const eid = s(employeeIdFilter.value)
    list = list.filter((r) => String(r.employeeId || '').includes(eid))
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.employeeId,
        r.employeeName,
        r.name,
        r.department,
        reasonText(r),
        r.status,
        r.approvalMode,
        r.requestStartDate,
        r.requestEndDate,
        r.offStartDate,
        r.offEndDate,
        r.managerLoginId,
        r.gmLoginId,
        r.cooLoginId,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }

  const df = s(dateFrom.value)
  const dt = s(dateTo.value)
  if (df && dt) {
    list = list.filter((r) => {
      const a = s(r.requestStartDate)
      const b = s(r.requestEndDate) || a
      if (!a) return false
      return a <= dt && b >= df
    })
  }

  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return list
})

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(filteredRows.value.length / per) || 1
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return filteredRows.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return filteredRows.value.slice(start, start + per)
})

watch(
  () => [
    search.value,
    statusFilter.value,
    approvalMode.value,
    employeeIdFilter.value,
    perPage.value,
    dateFrom.value,
    dateTo.value,
  ],
  () => {
    page.value = 1
  }
)

watch(
  () => pageCount.value,
  (n) => {
    if (page.value > n) page.value = n
    if (page.value < 1) page.value = 1
  }
)

/* ───────────────── DETAILS VIEW ───────────────── */
function openView(row) {
  viewItem.value = row
  viewOpen.value = true
}
function closeView() {
  viewOpen.value = false
  viewItem.value = null
}

/* ───────────────── ATTACHMENTS ───────────────── */
async function openFiles(row) {
  filesRequest.value = row
  filesItems.value = []
  try {
    const res = await api.get(`/leave/swap-working-day/${row._id}/evidence`)
    filesItems.value = normalizeEvidenceList(res.data)
  } catch (e) {
    filesItems.value = normalizeEvidenceList(row.attachments || [])
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load attachments list' })
  } finally {
    filesOpen.value = true
  }
}

async function refreshFilesAgain() {
  const req = filesRequest.value
  if (!req?._id) return
  try {
    const res = await api.get(`/leave/swap-working-day/${req._id}/evidence`)
    filesItems.value = normalizeEvidenceList(res.data)

    const idx = rows.value.findIndex((r) => String(r._id) === String(req._id))
    if (idx >= 0) rows.value[idx].attachments = filesItems.value
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Refresh attachments failed' })
  }
}

/* ───────────────── ACTIONS ───────────────── */
function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  approvalMode.value = 'ALL'
  employeeIdFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

function safeFileCount(row) {
  return Array.isArray(row?.attachments) ? row.attachments.length : 0
}

/* ───────────────── EXPORT EXCEL ───────────────── */
function excelRows(list) {
  return (list || []).map((r, idx) => ({
    No: idx + 1,
    CreatedAt: fmtDateTime(r.createdAt),
    EmployeeID: s(r.employeeId),
    EmployeeName: s(r.employeeName || r.name),
    Department: s(r.department),
    ApprovalMode: up(r.approvalMode),
    Status: up(r.status),
    RequestFrom: fmtYmd(r.requestStartDate),
    RequestTo: fmtYmd(r.requestEndDate),
    OffFrom: fmtYmd(r.offStartDate),
    OffTo: fmtYmd(r.offEndDate),
    Reason: reasonText(r),
  }))
}

async function exportExcel() {
  try {
    exporting.value = true
    const data = excelRows(filteredRows.value)
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'SwapDayReport')
    XLSX.writeFile(wb, `SwapDayReport_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
    showToast({ type: 'success', message: 'Excel exported.' })
  } catch (e) {
    showToast({ type: 'error', message: e?.message || 'Export failed' })
  } finally {
    exporting.value = false
  }
}

/* ───────────────── REALTIME ───────────────── */
function upsertRow(doc) {
  if (!doc?._id) return
  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  if (viewItem.value?._id && String(viewItem.value._id) === id) {
    viewItem.value = { ...viewItem.value, ...doc }
  }
  if (filesRequest.value?._id && String(filesRequest.value._id) === id) {
    filesRequest.value = { ...filesRequest.value, ...doc }
  }
}

function onSwapCreated(doc) {
  upsertRow(doc)
}
function onSwapUpdated(doc) {
  upsertRow(doc)
}

/* lifecycle */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_ADMIN' })
    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()
    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}

  await fetchRows()

  socket.on('swap:req:created', onSwapCreated)
  socket.on('swap:req:updated', onSwapUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  socket.off('swap:req:created', onSwapCreated)
  socket.off('swap:req:updated', onSwapUpdated)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-[16px] font-extrabold text-white">Swap Working Day Report</div>
                <span class="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold text-white ring-1 ring-inset ring-white/20">
                  Admin
                </span>
              </div>

              <!-- <div class="mt-1 text-[12px] text-white/80">
                Review all swap requests with compact filters, export, and realtime updates.
              </div> -->

              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span class="ui-badge ui-badge-warning">Pending: {{ pendingCount }}</span>
                <span class="ui-badge ui-badge-success">Approved: {{ approvedCount }}</span>
                <span class="ui-badge ui-badge-danger">Rejected: {{ rejectedCount }}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                class="ui-btn ui-btn-sm ui-btn-soft"
                type="button"
                :disabled="loading"
                @click="fetchRows"
                title="Refresh"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" />
                Refresh
              </button>

              <button
                class="ui-btn ui-btn-sm ui-btn-soft"
                type="button"
                :disabled="loading || exporting"
                @click="exportExcel"
                title="Export Excel"
              >
                <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                Export
              </button>

              <button
                class="ui-btn ui-btn-sm ui-btn-ghost"
                type="button"
                :disabled="loading"
                @click="clearFilters"
                title="Clear filters"
              >
                <i class="fa-solid fa-broom text-[11px]" />
                Clear
              </button>
            </div>
          </div>

          <!-- compact filter area -->
          <div class="mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
              <!-- Search -->
              <div class="xl:col-span-3 min-w-0">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Search
                </label>
                <div
                  class="flex items-center rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[11px]
                         focus-within:border-white/35 focus-within:bg-white/15"
                >
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/75" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee / ID / reason..."
                    class="w-full min-w-0 bg-transparent text-white placeholder:text-white/60 outline-none"
                  />
                </div>
              </div>

              <!-- Status -->
              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Status
                </label>
                <select
                  v-model="statusFilter"
                  class="filter-select"
                  title="Status"
                >
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>

              <!-- Mode -->
              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Approval mode
                </label>
                <select
                  v-model="approvalMode"
                  class="filter-select"
                  title="Approval mode"
                >
                  <option v-for="(label, key) in APPROVAL_MODE_LABEL" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>

              <!-- Employee ID -->
              <!-- <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Employee ID
                </label>
                <input
                  v-model="employeeIdFilter"
                  type="text"
                  placeholder="Employee ID"
                  class="filter-input"
                />
              </div> -->

              <!-- Request date from -->
              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Request from
                </label>
                <input
                  v-model="dateFrom"
                  type="date"
                  class="filter-input"
                  title="Request from"
                />
              </div>

              <!-- Request date to -->
              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Request to
                </label>
                <input
                  v-model="dateTo"
                  type="date"
                  class="filter-input"
                  title="Request to"
                />
              </div>

              <!-- Per Page -->
              <!-- <div class="xl:col-span-1">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Per page
                </label>
                <select
                  v-model="perPage"
                  class="filter-select"
                  title="Per page"
                >
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>
              </div> -->
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="loading && !filteredRows.length" class="ui-skeleton mb-2 h-14 w-full" />

          <!-- MOBILE CARDS -->
          <div v-if="isMobile" class="space-y-2">
            <div
              v-if="!pagedRows.length && !loading"
              class="ui-frame p-4 text-center text-[12px] text-slate-500"
            >
              No items found.
            </div>

            <article
              v-for="row in pagedRows"
              :key="row._id"
              class="ui-card cursor-pointer p-3"
              @click="openView(row)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Created:
                    <span class="font-extrabold text-slate-900 dark:text-slate-50">
                      {{ fmtDateTime(row.createdAt) }}
                    </span>
                  </div>

                  <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ row.employeeName || row.name || row.employeeId || '—' }}
                  </div>

                  <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    ID: {{ row.employeeId || '—' }} · {{ modeLabel(row.approvalMode) }}
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-1">
                  <span :class="statusBadgeUiClass(row.status)">
                    {{ STATUS_LABEL[row.status] || row.status }}
                  </span>
                </div>
              </div>

              <div class="mt-2 grid gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Work (Request) Date</div>
                  <div class="mt-0.5">
                    {{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}
                  </div>
                </div>

                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Swap (Off) Date</div>
                  <div class="mt-0.5">
                    {{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}
                  </div>
                </div>

                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                  <div class="mt-0.5">{{ briefText(reasonText(row), 140) }}</div>
                </div>
              </div>
            </article>
          </div>

          <!-- DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table table-fixed w-full min-w-[1180px]">
              <colgroup>
                <col :style="{ width: COL_WIDTH.created }" />
                <col :style="{ width: COL_WIDTH.employee }" />
                <col :style="{ width: COL_WIDTH.mode }" />
                <col :style="{ width: COL_WIDTH.workDate }" />
                <col :style="{ width: COL_WIDTH.swapDate }" />
                <col :style="{ width: COL_WIDTH.status }" />
                <col :style="{ width: COL_WIDTH.reason }" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Employee</th>
                  <th class="ui-th">Mode</th>
                  <th class="ui-th">Work (Request)</th>
                  <th class="ui-th">Swap (Off)</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !pagedRows.length">
                  <td colspan="7" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No items found.
                  </td>
                </tr>

                <tr
                  v-for="row in pagedRows"
                  :key="row._id"
                  class="ui-tr-hover cursor-pointer"
                  @click="openView(row)"
                >
                  <td class="ui-td">
                    <div class="truncate">{{ fmtDateTime(row.createdAt) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate font-extrabold text-slate-900 dark:text-slate-50">
                      {{ row.employeeName || row.name || row.employeeId || '—' }}
                    </div>
                    <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                      ID: {{ row.employeeId || '—' }}
                      <span v-if="row.department">· {{ row.department }}</span>
                    </div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ modeLabel(row.approvalMode) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">
                      {{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}
                    </div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">
                      {{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}
                    </div>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(row.status)">
                      {{ STATUS_LABEL[row.status] || row.status }}
                    </span>
                  </td>

                  <td class="ui-td">
                    <p class="reason-cell" :title="reasonText(row)">
                      {{ reasonText(row) }}
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            class="ui-divider mt-3 flex flex-col gap-2 pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <select v-model="perPage" class="ui-select !w-auto !py-1.5 !text-[11px]">
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
              </select>
              <span class="text-[11px] text-slate-500 dark:text-slate-400">
                Page {{ page }} / {{ pageCount }}
              </span>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAILS MODAL -->
    <div v-if="viewOpen" class="ui-modal-backdrop">
      <div class="ui-modal overflow-hidden p-0">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Swap Request Details</div>
            <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {{ viewItem?.employeeName || viewItem?.name || '—' }} · {{ fmtDateTime(viewItem?.createdAt) }}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeView">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>
        </div>

        <div class="space-y-3 p-4">
          <div class="ui-frame p-3">
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="ui-label">Employee</div>
                <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ viewItem?.employeeName || viewItem?.name || '—' }}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  ID: {{ viewItem?.employeeId || '—' }}
                </div>
                <div v-if="viewItem?.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                  Dept: {{ viewItem.department }}
                </div>
              </div>

              <div class="text-right md:text-left">
                <div class="ui-label">Status</div>
                <span :class="statusBadgeUiClass(viewItem?.status)">
                  {{ STATUS_LABEL[viewItem?.status] || viewItem?.status }}
                </span>

                <div class="mt-2 ui-label">Approval Mode</div>
                <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ modeLabel(viewItem?.approvalMode) }}
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-card p-3">
              <div class="ui-section-title">Swap (Sunday or Holiday)</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.requestStartDate) }} → {{ fmtYmd(viewItem?.requestEndDate) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">To (Working Day)</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.offStartDate) }} → {{ fmtYmd(viewItem?.offEndDate) }}
              </div>
            </div>
          </div>

          <div class="ui-card p-3">
            <div class="ui-section-title">Reason</div>
            <div class="mt-1 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
              {{ reasonText(viewItem) }}
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ATTACHMENT PREVIEW MODAL -->
    <!--
    <AttachmentPreviewModal
      v-model="filesOpen"
      :request-id="filesRequest?._id"
      title="Attachments"
      :subtitle="filesRequest ? `${fmtYmd(filesRequest.requestStartDate)} → ${fmtYmd(filesRequest.requestEndDate)}` : ''"
      :items="filesItems"
      :fetch-content-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}/content`"
      :delete-path="null"
      :can-delete="false"
      @refresh="refreshFilesAgain()"
    />
    -->
  </div>
</template>

<style scoped>
.filter-input,
.filter-select {
  width: 100%;
  border-radius: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  padding: 0.55rem 0.8rem;
  font-size: 11px;
  color: white;
  outline: none;
}

.filter-input::placeholder {
  color: rgba(255, 255, 255, 0.65);
}

.filter-input:focus,
.filter-select:focus {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.14);
}

.filter-select option {
  color: #0f172a;
}

.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}

.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>